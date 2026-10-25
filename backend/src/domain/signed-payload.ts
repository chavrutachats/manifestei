import type { Platform } from './entities.js';

/**
 * Formato canônico dos dados que o aparelho "assina" via App Attest / Play Integrity.
 *
 * O hash desta string vai dentro do token de atestação (requestHash no Android,
 * clientDataHash no iOS). O servidor NUNCA confia em um hash enviado pelo cliente:
 * ele reconstrói a string a partir dos campos recebidos e de dados que só ele
 * conhece (installationId do aparelho registrado, desafio emitido). Qualquer
 * alteração em trânsito — ou um app modificado trocando a coordenada depois de
 * atestar — quebra a verificação.
 *
 * ATENÇÃO: mobile/src/security/signedPayload.ts precisa produzir exatamente a
 * mesma string. Os dois lados têm teste com o mesmo vetor fixo.
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

/** Âncora: ANDROID_ID (hex) ou UUID do Keychain. Formato restrito para não colidir com o separador. */
export const DEVICE_ANCHOR_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function canonicalDeviceRegistration(p: {
  platform: Platform;
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
