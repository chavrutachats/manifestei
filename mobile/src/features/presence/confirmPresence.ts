import Integrity from '../../../modules/manifestei-integrity';
import { api } from '../../data/api';
import { ApiError } from '../../data/http';
import { secureStorage } from '../../data/secureStorage';
import type { PresenceSampleResult } from '../../domain/types';
import { AttestationUnavailableError, DeviceKeyLostError, deviceAttestor } from '../../security/attestation';
import { EnrollmentError, enrollDevice } from '../../security/enrollment';
import { ensurePreciseLocationPermission } from '../../security/location';
import { canonicalPresencePayload } from '../../security/signedPayload';

export type PresenceFailure =
  | 'LOCATION_DENIED'
  | 'LOCATION_IMPRECISE'
  | 'LOCATION_UNAVAILABLE'
  | 'ATTESTATION_UNAVAILABLE'
  | 'DEVICE_UNTRUSTED'
  | 'EVENT_CLOSED'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export class PresenceError extends Error {
  constructor(
    public readonly failure: PresenceFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PresenceError';
  }
}

const MESSAGES: Record<PresenceFailure, string> = {
  LOCATION_DENIED: 'Permita o acesso à localização para confirmar presença. Se não estiver no ato, você pode apoiar à distância.',
  LOCATION_IMPRECISE: 'Ative a "Localização precisa" para o Manifestei nos Ajustes do aparelho.',
  LOCATION_UNAVAILABLE: 'Não conseguimos ler o GPS. Vá para um lugar aberto e toque de novo.',
  ATTESTATION_UNAVAILABLE: 'Não foi possível verificar o aparelho agora. Toque de novo em instantes.',
  DEVICE_UNTRUSTED: 'Este aparelho não passou na verificação de integridade e não pode registrar presença.',
  EVENT_CLOSED: 'O registro de presença deste ato não está aberto agora.',
  NETWORK: 'Sem conexão com o servidor. Verifique a internet e toque de novo.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde um minuto.',
  UNKNOWN: 'Algo deu errado. Toque de novo.',
};

const fail = (f: PresenceFailure, message = MESSAGES[f]): never => {
  throw new PresenceError(f, message);
};

/**
 * "Estou no ato" — um toque, uma leitura:
 *
 *  1. desafio de uso único do servidor (antes do GPS, para o fix ser posterior a ele)
 *  2. leitura NATIVA do GPS, sem cache, com o sinal de localização simulada
 *  3. payload canônico = ato + desafio + instalação + coordenada + sinal
 *  4. atestação de hardware sobre o SHA-256 desse payload
 *  5. envio; o servidor reconstrói o payload e decide
 *
 * O app não decide nada sobre fraude: só coleta, assina e mostra o veredito.
 */
export async function confirmPresence(
  eventId: string,
  opts: { interactive?: boolean } = {},
): Promise<PresenceSampleResult> {
  // Em segundo plano não dá para mostrar o pedido de permissão: só confere.
  const perm = await ensurePreciseLocationPermission({ ask: opts.interactive ?? true });
  if (perm === 'denied') fail('LOCATION_DENIED');
  if (perm === 'imprecise') fail('LOCATION_IMPRECISE');

  for (let attempt = 0; attempt < 2; attempt++) {
    const firstAttempt = attempt === 0;
    try {
      let deviceId = await secureStorage.getDeviceId();
      if (!deviceId) {
        await enrollDevice();
        deviceId = await secureStorage.getDeviceId();
      }
      const installationId = await secureStorage.getInstallationId();
      const { challenge } = await api.presenceChallenge(eventId);

      let fix;
      try {
        fix = await Integrity.getCurrentLocation();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'E_LOCATION_REDUCED_ACCURACY') fail('LOCATION_IMPRECISE');
        if (code === 'E_LOCATION_PERMISSION') fail('LOCATION_DENIED');
        fail('LOCATION_UNAVAILABLE');
      }
      const location = {
        latitude: fix!.latitude,
        longitude: fix!.longitude,
        accuracyM: fix!.accuracyM,
        fixTimestampMs: Math.trunc(fix!.fixTimestampMs),
        isMock: fix!.isMock,
      };

      const clientData = canonicalPresencePayload({ eventId, challenge, installationId, ...location });
      const attestation = await deviceAttestor.attestPresence(clientData);
      return await api.submitPresence(eventId, { deviceId: deviceId!, challenge, location, attestation });
    } catch (err) {
      if (err instanceof PresenceError) throw err;
      // Chave do Secure Enclave perdida ou vínculo desativado: rematricula (mesma identidade) e repete uma vez.
      const needsEnrollment =
        err instanceof DeviceKeyLostError || (err instanceof ApiError && err.code === 'DEVICE_NOT_REGISTERED');
      if (needsEnrollment && firstAttempt) {
        await enrollDevice().catch((e: unknown) => {
          throw toPresenceError(e);
        });
        continue;
      }
      throw toPresenceError(err);
    }
  }
  return fail('UNKNOWN');
}

function toPresenceError(err: unknown): PresenceError {
  if (err instanceof PresenceError) return err;
  if (err instanceof EnrollmentError) {
    if (err.failure === 'UNTRUSTED') return new PresenceError('DEVICE_UNTRUSTED', err.message);
    if (err.failure === 'NETWORK') return new PresenceError('NETWORK', MESSAGES.NETWORK);
    if (err.failure === 'UNAVAILABLE') return new PresenceError('ATTESTATION_UNAVAILABLE', MESSAGES.ATTESTATION_UNAVAILABLE);
    return new PresenceError('UNKNOWN', err.message);
  }
  if (err instanceof AttestationUnavailableError) return new PresenceError('ATTESTATION_UNAVAILABLE', MESSAGES.ATTESTATION_UNAVAILABLE);
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return new PresenceError('NETWORK', MESSAGES.NETWORK);
    if (err.code === 'EVENT_CLOSED') return new PresenceError('EVENT_CLOSED', err.message);
    if (err.code === 'RATE_LIMITED') return new PresenceError('RATE_LIMITED', MESSAGES.RATE_LIMITED);
    if (err.code === 'ATTESTATION_UNAVAILABLE') return new PresenceError('ATTESTATION_UNAVAILABLE', MESSAGES.ATTESTATION_UNAVAILABLE);
    return new PresenceError('UNKNOWN', err.message);
  }
  return new PresenceError('UNKNOWN', MESSAGES.UNKNOWN);
}
