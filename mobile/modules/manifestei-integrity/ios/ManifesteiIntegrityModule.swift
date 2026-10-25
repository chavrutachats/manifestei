import CoreLocation
import DeviceCheck
import ExpoModulesCore

/// Ponte nativa do Manifestei para iOS.
///
/// App Attest: a chave privada é gerada e fica no Secure Enclave; nunca sai do aparelho.
/// O servidor recebe a atestação (uma vez) e asserções (a cada check-in), ambas
/// assinadas sobre o SHA-256 do payload canônico (`clientDataHash`).
public class ManifesteiIntegrityModule: Module {
  private var pendingLocationRequests: [OneShotLocationRequest] = []

  public func definition() -> ModuleDefinition {
    Name("ManifesteiIntegrity")

    // ------------------------------------------------------------- App Attest
    AsyncFunction("isAppAttestSupported") { () -> Bool in
      // false no Simulador e em aparelhos sem Secure Enclave
      return DCAppAttestService.shared.isSupported
    }

    AsyncFunction("generateAppAttestKey") { (promise: Promise) in
      let service = DCAppAttestService.shared
      guard service.isSupported else {
        promise.reject("E_APP_ATTEST_UNSUPPORTED", "App Attest indisponível neste aparelho")
        return
      }
      service.generateKey { keyId, error in
        if let error = error {
          promise.reject("E_APP_ATTEST_KEYGEN", error.localizedDescription)
        } else if let keyId = keyId {
          promise.resolve(keyId)
        } else {
          promise.reject("E_APP_ATTEST_KEYGEN", "keyId vazio")
        }
      }
    }

    AsyncFunction("attestAppAttestKey") { (keyId: String, clientDataHashBase64: String, promise: Promise) in
      guard let hash = Data(base64Encoded: clientDataHashBase64), hash.count == 32 else {
        promise.reject("E_APP_ATTEST_INPUT", "clientDataHash deve ser SHA-256 em base64")
        return
      }
      DCAppAttestService.shared.attestKey(keyId, clientDataHash: hash) { attestation, error in
        if let error = error {
          // DCError.serverUnavailable é transitório: o JS tenta de novo depois
          promise.reject(Self.errorCode(error, fallback: "E_APP_ATTEST_ATTEST"), error.localizedDescription)
        } else if let attestation = attestation {
          promise.resolve(attestation.base64EncodedString())
        } else {
          promise.reject("E_APP_ATTEST_ATTEST", "atestação vazia")
        }
      }
    }

    AsyncFunction("generateAppAttestAssertion") { (keyId: String, clientDataHashBase64: String, promise: Promise) in
      guard let hash = Data(base64Encoded: clientDataHashBase64), hash.count == 32 else {
        promise.reject("E_APP_ATTEST_INPUT", "clientDataHash deve ser SHA-256 em base64")
        return
      }
      DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: hash) { assertion, error in
        if let error = error {
          // DCError.invalidKey: chave perdida (restore de backup, reinstalação) → JS re-registra o aparelho
          promise.reject(Self.errorCode(error, fallback: "E_APP_ATTEST_ASSERT"), error.localizedDescription)
        } else if let assertion = assertion {
          promise.resolve(assertion.base64EncodedString())
        } else {
          promise.reject("E_APP_ATTEST_ASSERT", "asserção vazia")
        }
      }
    }

    // ------------------------------------------------- Play Integrity (Android)
    AsyncFunction("preparePlayIntegrity") { (_: String, promise: Promise) in
      promise.reject("E_PLATFORM", "Play Integrity só existe no Android")
    }
    AsyncFunction("requestPlayIntegrityToken") { (_: String, promise: Promise) in
      promise.reject("E_PLATFORM", "Play Integrity só existe no Android")
    }

    // ------------------------------------------------------------- Localização
    AsyncFunction("getCurrentLocation") { (promise: Promise) in
      let request = OneShotLocationRequest { [weak self] result, finished in
        self?.pendingLocationRequests.removeAll { $0 === finished }
        switch result {
        case .success(let fix):
          promise.resolve(fix)
        case .failure(let error):
          promise.reject(error.code, error.message)
        }
      }
      self.pendingLocationRequests.append(request)
      request.start()
    }.runOnQueue(.main) // CLLocationManager precisa de um run loop: main thread

  }

  private static func errorCode(_ error: Error, fallback: String) -> String {
    guard let dcError = error as? DCError else { return fallback }
    switch dcError.code {
    case .invalidKey: return "E_APP_ATTEST_INVALID_KEY"
    case .serverUnavailable: return "E_APP_ATTEST_SERVER_UNAVAILABLE"
    case .featureUnsupported: return "E_APP_ATTEST_UNSUPPORTED"
    default: return fallback
    }
  }
}

struct LocationError: Error {
  let code: String
  let message: String
}

/// Uma leitura de alta precisão com timeout. Mantida viva pelo módulo até concluir.
final class OneShotLocationRequest: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let completion: (Result<[String: Any], LocationError>, OneShotLocationRequest) -> Void
  private var done = false
  private var timeout: DispatchWorkItem?

  init(completion: @escaping (Result<[String: Any], LocationError>, OneShotLocationRequest) -> Void) {
    self.completion = completion
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    // Leituras automáticas acontecem com o app em segundo plano (registro de presença
    // ativo, indicador azul visível). Só é permitido ligar isto se o app declara o modo
    // de fundo "location" no Info.plist — sem a declaração o iOS encerra o app.
    if OneShotLocationRequest.hasLocationBackgroundMode {
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
    }
  }

  private static let hasLocationBackgroundMode: Bool = {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return modes.contains("location")
  }()

  func start() {
    let status = manager.authorizationStatus
    guard status == .authorizedWhenInUse || status == .authorizedAlways else {
      finish(.failure(LocationError(code: "E_LOCATION_PERMISSION", message: "Permissão de localização não concedida")))
      return
    }
    // "Localização precisa" desligada pelo usuário: precisão de quilômetros, inútil para geocerca
    if manager.accuracyAuthorization == .reducedAccuracy {
      finish(.failure(LocationError(code: "E_LOCATION_REDUCED_ACCURACY", message: "Ative a Localização Precisa para o Manifestei")))
      return
    }
    let work = DispatchWorkItem { [weak self] in
      self?.finish(.failure(LocationError(code: "E_LOCATION_TIMEOUT", message: "Não foi possível obter o GPS a tempo")))
    }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
    manager.requestLocation()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let loc = locations.last, loc.horizontalAccuracy >= 0 else { return }
    var simulated = false
    if let info = loc.sourceInformation {
      // isSimulatedBySoftware: Xcode, ferramentas de "fake GPS" via desenvolvedor, jailbreak tweaks que usam a API
      // isProducedByAccessory: GPS externo (MFi) — pode injetar coordenadas arbitrárias
      simulated = info.isSimulatedBySoftware || info.isProducedByAccessory
    }
    finish(.success([
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "accuracyM": loc.horizontalAccuracy,
      "fixTimestampMs": (loc.timestamp.timeIntervalSince1970 * 1000).rounded(),
      "isMock": simulated,
    ]))
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish(.failure(LocationError(code: "E_LOCATION", message: error.localizedDescription)))
  }

  private func finish(_ result: Result<[String: Any], LocationError>) {
    guard !done else { return }
    done = true
    timeout?.cancel()
    manager.stopUpdatingLocation()
    manager.delegate = nil
    completion(result, self)
  }
}
