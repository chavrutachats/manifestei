package expo.modules.manifesteiintegrity

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ponte nativa do Manifestei para Android.
 *
 * Play Integrity (standard request): o `requestHash` é o SHA-256 do payload canônico.
 * O Google embute esse hash no token assinado; o servidor confere que o token foi
 * emitido para AQUELE payload, por um app reconhecido pela Play, num aparelho íntegro.
 */
class ManifesteiIntegrityModule : Module() {
  @Volatile
  private var tokenProvider: StandardIntegrityTokenProvider? = null

  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ManifesteiIntegrity")

    // ------------------------------------------------------- Play Integrity
    AsyncFunction("preparePlayIntegrity") { cloudProjectNumber: String, promise: Promise ->
      val number = cloudProjectNumber.toLongOrNull()
      if (number == null) {
        promise.reject("E_INTEGRITY_CONFIG", "cloudProjectNumber inválido", null)
        return@AsyncFunction
      }
      IntegrityManagerFactory.createStandard(context)
        .prepareIntegrityToken(
          PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(number).build()
        )
        .addOnSuccessListener { provider ->
          tokenProvider = provider
          promise.resolve(true)
        }
        .addOnFailureListener { e ->
          promise.reject(integrityErrorCode(e, "E_INTEGRITY_PREPARE"), e.message ?: "Falha ao preparar a Play Integrity", e)
        }
    }

    AsyncFunction("requestPlayIntegrityToken") { requestHash: String, promise: Promise ->
      val provider = tokenProvider
      if (provider == null) {
        promise.reject("E_INTEGRITY_NOT_PREPARED", "Chame preparePlayIntegrity antes", null)
        return@AsyncFunction
      }
      provider.request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
        .addOnSuccessListener { response -> promise.resolve(response.token()) }
        .addOnFailureListener { e ->
          // INTEGRITY_TOKEN_PROVIDER_INVALID etc.: descarta o provider; o JS prepara de novo e repete
          tokenProvider = null
          promise.reject(integrityErrorCode(e, "E_INTEGRITY_REQUEST"), e.message ?: "Falha ao obter token de integridade", e)
        }
    }

    // ---------------------------------------------------------- App Attest (iOS)
    AsyncFunction("isAppAttestSupported") { false }
    AsyncFunction("generateAppAttestKey") { promise: Promise ->
      promise.reject("E_PLATFORM", "App Attest só existe no iOS", null)
    }
    AsyncFunction("attestAppAttestKey") { _: String, _: String, promise: Promise ->
      promise.reject("E_PLATFORM", "App Attest só existe no iOS", null)
    }
    AsyncFunction("generateAppAttestAssertion") { _: String, _: String, promise: Promise ->
      promise.reject("E_PLATFORM", "App Attest só existe no iOS", null)
    }

    // ------------------------------------------------------------ Localização
    AsyncFunction("getCurrentLocation") { promise: Promise ->
      currentLocation(promise)
    }
  }

  @SuppressLint("MissingPermission")
  private fun currentLocation(promise: Promise) {
    val ctx = context
    val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    if (!granted) {
      // Android 12+: o usuário pode conceder só "aproximada" — inútil para geocerca
      promise.reject("E_LOCATION_PERMISSION", "Permissão de localização PRECISA não concedida", null)
      return
    }

    val request = CurrentLocationRequest.Builder()
      .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
      .setMaxUpdateAgeMillis(0) // nunca reutiliza fix em cache
      .setDurationMillis(15_000) // rajada curta: bateria
      .build()

    LocationServices.getFusedLocationProviderClient(ctx)
      .getCurrentLocation(request, CancellationTokenSource().token)
      .addOnSuccessListener { location: Location? ->
        if (location == null || !location.hasAccuracy()) {
          promise.reject("E_LOCATION_UNAVAILABLE", "Sem sinal de GPS. Tente em local aberto.", null)
        } else {
          promise.resolve(
            mapOf(
              "latitude" to location.latitude,
              "longitude" to location.longitude,
              "accuracyM" to location.accuracy.toDouble(),
              "fixTimestampMs" to location.time.toDouble(),
              "isMock" to isMock(location),
            )
          )
        }
      }
      .addOnFailureListener { e ->
        promise.reject("E_LOCATION", e.message ?: "Falha ao obter localização", e)
      }
  }

  /**
   * StandardIntegrityException estende ApiException; o statusCode é o código da Play Integrity.
   * -1 API_NOT_AVAILABLE, -2 PLAY_STORE_NOT_FOUND, -6 PLAY_SERVICES_NOT_FOUND: o aparelho
   * simplesmente não tem como atestar (emulador puro, ROM sem Google). Todo o resto
   * (rede, limite de requisições, Play desatualizada) é transitório e o app tenta de novo.
   */
  private fun integrityErrorCode(e: Exception, fallback: String): String {
    val status = (e as? ApiException)?.statusCode ?: return fallback
    return if (status == -1 || status == -2 || status == -6) "E_INTEGRITY_UNAVAILABLE_ON_DEVICE" else fallback
  }

  /** Localização vinda de um "mock location provider" (Opções do desenvolvedor / apps de fake GPS). */
  private fun isMock(location: Location): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      location.isMock
    } else {
      @Suppress("DEPRECATION")
      location.isFromMockProvider
    }
}
