import { GoogleAuth } from 'google-auth-library';
import type { AndroidIntegrityVerifier } from '../../application/ports.js';
import type { AttestationCheck } from '../../domain/presence.js';

/**
 * Play Integrity API — requisições "standard" (recomendadas pelo Google para
 * chamadas frequentes). O token é decodificado nos servidores do Google
 * (decodeIntegrityToken); a decisão é tomada aqui, por função pura e testável.
 *
 * Documentação: https://developer.android.com/google/play/integrity/verdicts
 */

export interface PlayIntegrityPayload {
  requestDetails?: {
    requestPackageName?: string;
    requestHash?: string;
    timestampMillis?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: 'PLAY_RECOGNIZED' | 'UNRECOGNIZED_VERSION' | 'UNEVALUATED' | string;
    packageName?: string;
    certificateSha256Digest?: string[];
    versionCode?: string;
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
    /** Opt-in no Play Console. LEVEL_4 = volume anormal de tokens no aparelho (fazenda de bots). */
    recentDeviceActivity?: { deviceActivityLevel?: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | 'LEVEL_4' | 'UNEVALUATED' | string };
  };
  accountDetails?: {
    appLicensingVerdict?: 'LICENSED' | 'UNLICENSED' | 'UNEVALUATED' | string;
  };
  environmentDetails?: {
    playProtectVerdict?: string;
    appAccessRiskVerdict?: { appsDetected?: string[] };
  };
}

export interface PlayIntegrityPolicy {
  packageName: string;
  /** SHA-256 (base64url, como o Google devolve) dos certificados de assinatura aceitos. Vazio = não checa. */
  allowedCertificateDigests: string[];
  requireStrongIntegrity: boolean;
  requireLicensed: boolean;
  maxTokenAgeMs: number;
  /**
   * Recusa aparelhos com app desconhecido capaz de CONTROLAR a tela (acessibilidade
   * abusada, automação, acesso remoto). É o sinal típico de bot que "aperta o botão"
   * por uma pessoa. Requer opt-in do "app access risk" no Play Console.
   */
  rejectUnknownControllingApps: boolean;
  /** Recusa LEVEL_4 de atividade recente (requer opt-in). */
  rejectHighDeviceActivity: boolean;
}

/**
 * O Play Console mostra o SHA-256 do certificado em hex com dois-pontos
 * ("AB:CD:..."); o token traz em base64url. Normaliza ambos para hex minúsculo.
 */
export function normalizeCertDigest(d: string): string {
  const s = d.trim();
  const hex = s.replace(/:/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
}

/** Avaliação pura do veredito. Exportada para testes. */
export function evaluatePlayIntegrityPayload(
  p: PlayIntegrityPayload,
  expectedRequestHash: string,
  policy: PlayIntegrityPolicy,
  now: Date,
): AttestationCheck {
  const rd = p.requestDetails;
  if (!rd || rd.requestPackageName !== policy.packageName) {
    return { ok: false, failure: 'INVALID', detail: 'REQUEST_PACKAGE_MISMATCH' };
  }
  if (rd.requestHash !== expectedRequestHash) {
    return { ok: false, failure: 'BINDING_MISMATCH', detail: 'REQUEST_HASH_MISMATCH' };
  }
  const ts = Number(rd.timestampMillis);
  if (!Number.isFinite(ts) || now.getTime() - ts > policy.maxTokenAgeMs || ts - now.getTime() > 60_000) {
    return { ok: false, failure: 'INVALID', detail: 'TOKEN_STALE' };
  }

  const app = p.appIntegrity;
  if (app?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    return { ok: false, failure: 'APP_INTEGRITY', detail: `APP_${app?.appRecognitionVerdict ?? 'MISSING'}` };
  }
  if (app.packageName !== policy.packageName) {
    return { ok: false, failure: 'APP_INTEGRITY', detail: 'APP_PACKAGE_MISMATCH' };
  }
  if (policy.allowedCertificateDigests.length > 0) {
    const allowed = new Set(policy.allowedCertificateDigests.map(normalizeCertDigest));
    const digests = (app.certificateSha256Digest ?? []).map(normalizeCertDigest);
    if (!digests.some((d) => allowed.has(d))) {
      return { ok: false, failure: 'APP_INTEGRITY', detail: 'SIGNING_CERT_MISMATCH' };
    }
  }

  const verdicts = p.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const required = policy.requireStrongIntegrity ? 'MEETS_STRONG_INTEGRITY' : 'MEETS_DEVICE_INTEGRITY';
  // MEETS_VIRTUAL_INTEGRITY = emulador oficial do Google Play Games para PC: não vale como presença física.
  if (!verdicts.includes(required)) {
    return { ok: false, failure: 'DEVICE_INTEGRITY', detail: `DEVICE_${verdicts.join('+') || 'NONE'}` };
  }

  if (policy.requireLicensed && p.accountDetails?.appLicensingVerdict !== 'LICENSED') {
    return { ok: false, failure: 'APP_INTEGRITY', detail: 'NOT_LICENSED' };
  }
  if (p.environmentDetails?.playProtectVerdict === 'HIGH_RISK') {
    return { ok: false, failure: 'DEVICE_INTEGRITY', detail: 'PLAY_PROTECT_HIGH_RISK' };
  }
  if (
    policy.rejectHighDeviceActivity &&
    p.deviceIntegrity?.recentDeviceActivity?.deviceActivityLevel === 'LEVEL_4'
  ) {
    return { ok: false, failure: 'DEVICE_INTEGRITY', detail: 'DEVICE_ACTIVITY_LEVEL_4' };
  }
  const apps = p.environmentDetails?.appAccessRiskVerdict?.appsDetected ?? [];
  if (policy.rejectUnknownControllingApps && apps.includes('UNKNOWN_CONTROLLING')) {
    return { ok: false, failure: 'DEVICE_INTEGRITY', detail: 'UNKNOWN_CONTROLLING_APP' };
  }
  return { ok: true };
}

export interface PlayIntegrityDecoder {
  decode(integrityToken: string): Promise<PlayIntegrityPayload>;
}

export class PlayIntegrityDecodeError extends Error {
  constructor(
    public readonly kind: 'INVALID_TOKEN' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

/** Chama playintegrity.googleapis.com com uma service account do projeto Google Cloud vinculado. */
export class GooglePlayIntegrityDecoder implements PlayIntegrityDecoder {
  private readonly auth: GoogleAuth;

  constructor(
    private readonly packageName: string,
    serviceAccountJson?: string,
  ) {
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/playintegrity'],
      ...(serviceAccountJson ? { credentials: JSON.parse(serviceAccountJson) as Record<string, string> } : {}),
    });
  }

  async decode(integrityToken: string): Promise<PlayIntegrityPayload> {
    try {
      const client = await this.auth.getClient();
      const res = await client.request<{ tokenPayloadExternal?: PlayIntegrityPayload }>({
        url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.packageName)}:decodeIntegrityToken`,
        method: 'POST',
        data: { integrityToken },
        timeout: 8000,
      });
      if (!res.data.tokenPayloadExternal) throw new PlayIntegrityDecodeError('INVALID_TOKEN', 'empty payload');
      return res.data.tokenPayloadExternal;
    } catch (err) {
      if (err instanceof PlayIntegrityDecodeError) throw err;
      const status =
        (err as { status?: number }).status ?? (err as { response?: { status?: number } }).response?.status;
      // 400 = token malformado/forjado/de outro app. 429/5xx/rede = indisponibilidade.
      if (status === 400) throw new PlayIntegrityDecodeError('INVALID_TOKEN', 'token rejected by Google');
      throw new PlayIntegrityDecodeError('UNAVAILABLE', `Play Integrity unavailable (${status ?? 'network'})`);
    }
  }
}

export class PlayIntegrityVerifier implements AndroidIntegrityVerifier {
  constructor(
    private readonly decoder: PlayIntegrityDecoder,
    private readonly policy: PlayIntegrityPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(input: { integrityToken: string; expectedRequestHash: string }): Promise<AttestationCheck> {
    if (!input.integrityToken || input.integrityToken.length > 20_000) {
      return { ok: false, failure: 'INVALID', detail: 'TOKEN_SIZE' };
    }
    let payload: PlayIntegrityPayload;
    try {
      payload = await this.decoder.decode(input.integrityToken);
    } catch (err) {
      if (err instanceof PlayIntegrityDecodeError && err.kind === 'INVALID_TOKEN') {
        return { ok: false, failure: 'INVALID', detail: 'TOKEN_REJECTED' };
      }
      return { ok: false, failure: 'PROVIDER_UNAVAILABLE' };
    }
    return evaluatePlayIntegrityPayload(payload, input.expectedRequestHash, this.policy, this.now());
  }
}
