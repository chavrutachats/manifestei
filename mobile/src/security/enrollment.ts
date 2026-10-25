import { Platform } from 'react-native';
import { config } from '../config';
import { api } from '../data/api';
import { ApiError, session } from '../data/http';
import { secureStorage } from '../data/secureStorage';
import { AttestationUnavailableError, deviceAttestor } from './attestation';
import { canonicalDeviceRegistration } from './signedPayload';

export type EnrollmentFailure = 'UNTRUSTED' | 'UNAVAILABLE' | 'LOCKED' | 'CONSENT' | 'NETWORK' | 'UNKNOWN';

export class EnrollmentError extends Error {
  constructor(
    public readonly failure: EnrollmentFailure,
    message: string,
  ) {
    super(message);
    this.name = 'EnrollmentError';
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Matrícula do aparelho — o substituto do cadastro. Nenhum dado da pessoa é pedido.
 *
 * O app manda a âncora do aparelho dentro de um payload atestado pela Apple/Google;
 * o servidor devolve a identidade anônima DESTE aparelho (sempre a mesma, mesmo
 * depois de reinstalar) e uma sessão. Chamar de novo é seguro: só renova o vínculo.
 */
export function enrollDevice(): Promise<void> {
  inFlight ??= doEnroll().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doEnroll(): Promise<void> {
  await secureStorage.clearDeviceBinding();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const [installationId, deviceAnchor] = await Promise.all([
    secureStorage.getInstallationId(),
    secureStorage.getDeviceAnchor(),
  ]);
  try {
    const { challenge } = await api.enrollChallenge(installationId);
    const clientData = canonicalDeviceRegistration({ platform, challenge, installationId, deviceAnchor });
    const attestation = await deviceAttestor.attestRegistration(clientData);
    const res = await api.enroll({
      platform,
      installationId,
      deviceAnchor,
      consentVersion: config.consentVersion,
      challenge,
      attestation,
    });
    await session.start(res);
    if (attestation.kind === 'ios') await secureStorage.setAppAttestKeyId(attestation.keyId);
    await secureStorage.setDeviceId(res.deviceId);
  } catch (err) {
    throw toEnrollmentError(err);
  }
}

function toEnrollmentError(err: unknown): EnrollmentError {
  if (err instanceof EnrollmentError) return err;
  if (err instanceof AttestationUnavailableError) {
    return new EnrollmentError('UNAVAILABLE', 'O serviço de verificação da Apple/Google não respondeu. Tente de novo em instantes.');
  }
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'DEVICE_NOT_TRUSTED':
        return new EnrollmentError('UNTRUSTED', err.message);
      case 'RATE_LIMITED':
        return new EnrollmentError('LOCKED', err.message);
      case 'CONSENT_REQUIRED':
        return new EnrollmentError('CONSENT', err.message);
      case 'ATTESTATION_UNAVAILABLE':
        return new EnrollmentError('UNAVAILABLE', err.message);
      case 'NETWORK':
        return new EnrollmentError('NETWORK', err.message);
    }
    return new EnrollmentError('UNKNOWN', err.message);
  }
  return new EnrollmentError('UNKNOWN', 'Não foi possível verificar o aparelho.');
}
