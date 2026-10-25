/**
 * Formato canônico dos dados que o aparelho assina (App Attest / Play Integrity).
 *
 * DEVE produzir exatamente a mesma string que backend/src/domain/signed-payload.ts.
 * O servidor NÃO recebe esta string: ele a reconstrói a partir dos campos do
 * request e do installationId que ele mesmo guardou no registro do aparelho.
 * Se qualquer campo divergir (coordenada trocada depois de assinar, outro
 * aparelho, outro desafio), a assinatura não confere.
 *
 * Vetor de teste compartilhado: scripts/verify-contract.ts.
 */
export const SIGNED_PAYLOAD_VERSION = 'mf1';

export interface PresencePayloadFields {
  eventId: string;
  challenge: string;
  installationId: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  fixTimestampMs: number;
  isMock: boolean;
}

export function canonicalPresencePayload(p: PresencePayloadFields): string {
  return [
    SIGNED_PAYLOAD_VERSION,
    'presence',
    p.eventId,
    p.challenge,
    p.installationId,
    p.latitude.toFixed(6),
    p.longitude.toFixed(6),
    p.accuracyM.toFixed(1),
    String(Math.trunc(p.fixTimestampMs)),
    p.isMock ? '1' : '0',
  ].join('|');
}

export function canonicalDeviceRegistration(p: {
  platform: 'ios' | 'android';
  challenge: string;
  installationId: string;
  deviceAnchor: string;
}): string {
  return [
    SIGNED_PAYLOAD_VERSION,
    'device-registration',
    p.platform,
    p.challenge,
    p.installationId,
    p.deviceAnchor,
  ].join('|');
}
