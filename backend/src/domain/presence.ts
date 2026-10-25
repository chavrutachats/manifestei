/**
 * Núcleo da regra de presença. Funções puras: nenhuma I/O, nenhuma dependência
 * de framework. Todo o resto do sistema existe para produzir `SampleSignals`
 * confiáveis e persistir o `AttendanceState` resultante.
 */

export type PresenceStatus = 'PENDING_ON_SITE' | 'CONFIRMED_ON_SITE' | 'VIRTUAL_SUPPORTER';

/** Motivos que rebaixam alguém para Apoiador Virtual. */
export type VirtualReason =
  | 'DECLARED_BY_USER'
  | 'UNTRUSTED_DEVICE'
  | 'DEVICE_INTEGRITY_FAILED'
  | 'APP_INTEGRITY_FAILED'
  | 'ATTESTATION_INVALID'
  | 'PAYLOAD_TAMPERED'
  | 'MOCK_LOCATION'
  | 'IMPOSSIBLE_TRAVEL'
  | 'DEVICE_SHARED';

/** Motivos que invalidam só a amostra, sem punir o usuário. */
export type InconclusiveReason =
  | 'LOW_ACCURACY'
  | 'OUTSIDE_AREA'
  | 'OUTSIDE_TIME_WINDOW'
  | 'STALE_OR_SKEWED_FIX'
  | 'ATTESTATION_PROVIDER_UNAVAILABLE';

export type AttestationFailure =
  | 'UNSUPPORTED'
  | 'DEVICE_INTEGRITY'
  | 'APP_INTEGRITY'
  | 'BINDING_MISMATCH'
  | 'INVALID'
  | 'PROVIDER_UNAVAILABLE';

export type AttestationCheck = { ok: true } | { ok: false; failure: AttestationFailure; detail?: string };

export interface SampleSignals {
  attestation: AttestationCheck;
  /** Android: Location.isMock(); iOS: CLLocationSourceInformation.isSimulatedBySoftware. */
  isMockLocation: boolean;
  accuracyM: number;
  /** 0 quando dentro da área do evento. Calculado no servidor (PostGIS). */
  distanceToAreaM: number;
  withinEventWindow: boolean;
  /** serverNow - fixTimestamp (ms). Positivo = fix no passado. */
  fixAgeMs: number;
  /** Velocidade mínima plausível desde a última amostra, já descontada a imprecisão do GPS. */
  impliedSpeedMps: number | null;
  /** Este aparelho já validou presença de OUTRO usuário neste evento. */
  deviceUsedByAnotherUser: boolean;
}

export type SampleVerdict =
  | { kind: 'VALID' }
  | { kind: 'INCONCLUSIVE'; reason: InconclusiveReason }
  | { kind: 'FRAUD'; reason: VirtualReason };

export interface PresencePolicyConfig {
  maxAccuracyM: number;
  areaToleranceM: number;
  maxFixAgeMs: number;
  maxFutureSkewMs: number;
  maxPlausibleSpeedMps: number;
  minValidSamples: number;
  minDwellMs: number;
  /**
   * De quanto em quanto tempo o app faz uma leitura automática enquanto a pessoa
   * está no ato. Serve à confirmação E à medição de permanência (pico, queda, média).
   */
  sampleIntervalMs: number;
}

/**
 * Padrão: a pessoa toca UMA vez em "Estou no ato" e o app faz o resto sozinho.
 * Leituras automáticas a cada 15 min; a presença é confirmada quando há duas
 * leituras válidas separadas por pelo menos 45 min. Quem só passa pela avenida
 * (de carro, de ônibus, a caminho de outro lugar) não chega a ser confirmado.
 */
export const DEFAULT_PRESENCE_POLICY: PresencePolicyConfig = {
  maxAccuracyM: 50,
  areaToleranceM: 25,
  maxFixAgeMs: 120_000,
  maxFutureSkewMs: 30_000,
  maxPlausibleSpeedMps: 70,
  minValidSamples: 2,
  minDwellMs: 45 * 60_000,
  sampleIntervalMs: 15 * 60_000,
};

/** Alternativa: a primeira leitura válida já confirma (sem prova de permanência). */
export const ONE_TAP_PRESENCE_POLICY: PresencePolicyConfig = {
  ...DEFAULT_PRESENCE_POLICY,
  minValidSamples: 1,
  minDwellMs: 0,
};

export interface AttendanceState {
  status: PresenceStatus;
  virtualReason: VirtualReason | null;
  validSampleCount: number;
  firstValidSampleAt: Date | null;
  lastValidSampleAt: Date | null;
  confirmedAt: Date | null;
  downgradedAt: Date | null;
}

export const initialAttendanceState = (): AttendanceState => ({
  status: 'PENDING_ON_SITE',
  virtualReason: null,
  validSampleCount: 0,
  firstValidSampleAt: null,
  lastValidSampleAt: null,
  confirmedAt: null,
  downgradedAt: null,
});

const ATTESTATION_FAILURE_TO_REASON: Record<Exclude<AttestationFailure, 'PROVIDER_UNAVAILABLE'>, VirtualReason> = {
  UNSUPPORTED: 'UNTRUSTED_DEVICE',
  DEVICE_INTEGRITY: 'DEVICE_INTEGRITY_FAILED',
  APP_INTEGRITY: 'APP_INTEGRITY_FAILED',
  BINDING_MISMATCH: 'PAYLOAD_TAMPERED',
  INVALID: 'ATTESTATION_INVALID',
};

/**
 * Avalia uma amostra. A ordem importa: sinais de fraude são checados antes
 * dos sinais de "amostra ruim", para que um GPS falso fora da área seja
 * tratado como fraude, e não como simples "fora da área".
 */
export function evaluateSample(s: SampleSignals, cfg: PresencePolicyConfig): SampleVerdict {
  if (!s.attestation.ok) {
    if (s.attestation.failure === 'PROVIDER_UNAVAILABLE') {
      return { kind: 'INCONCLUSIVE', reason: 'ATTESTATION_PROVIDER_UNAVAILABLE' };
    }
    return { kind: 'FRAUD', reason: ATTESTATION_FAILURE_TO_REASON[s.attestation.failure] };
  }
  if (s.isMockLocation) return { kind: 'FRAUD', reason: 'MOCK_LOCATION' };
  if (s.deviceUsedByAnotherUser) return { kind: 'FRAUD', reason: 'DEVICE_SHARED' };
  if (s.impliedSpeedMps !== null && s.impliedSpeedMps > cfg.maxPlausibleSpeedMps) {
    return { kind: 'FRAUD', reason: 'IMPOSSIBLE_TRAVEL' };
  }

  if (!s.withinEventWindow) return { kind: 'INCONCLUSIVE', reason: 'OUTSIDE_TIME_WINDOW' };
  if (s.fixAgeMs > cfg.maxFixAgeMs || s.fixAgeMs < -cfg.maxFutureSkewMs) {
    return { kind: 'INCONCLUSIVE', reason: 'STALE_OR_SKEWED_FIX' };
  }
  if (!Number.isFinite(s.accuracyM) || s.accuracyM <= 0 || s.accuracyM > cfg.maxAccuracyM) {
    return { kind: 'INCONCLUSIVE', reason: 'LOW_ACCURACY' };
  }
  const tolerance = Math.min(s.accuracyM, cfg.areaToleranceM);
  if (s.distanceToAreaM > tolerance) return { kind: 'INCONCLUSIVE', reason: 'OUTSIDE_AREA' };

  return { kind: 'VALID' };
}

/** Rebaixamentos por fraude são definitivos para aquele evento (impede "tentar até passar"). */
export const isFraudDowngrade = (st: AttendanceState): boolean =>
  st.status === 'VIRTUAL_SUPPORTER' && st.virtualReason !== null && st.virtualReason !== 'DECLARED_BY_USER';

/**
 * Máquina de estados:
 *
 *   PENDING ──válida×N, permanência≥T──▶ CONFIRMED
 *      │                                    │
 *      └────────── fraude ──▶ VIRTUAL ◀──── fraude
 *                    ▲
 *   VIRTUAL(declarado) ──válida──▶ PENDING (quem apoiou online e depois foi ao ato)
 *   VIRTUAL(fraude): terminal.
 */
export function applyVerdict(
  current: AttendanceState,
  verdict: SampleVerdict,
  at: Date,
  cfg: PresencePolicyConfig,
): AttendanceState {
  if (isFraudDowngrade(current)) return current;

  if (verdict.kind === 'FRAUD') {
    return {
      ...current,
      status: 'VIRTUAL_SUPPORTER',
      virtualReason: verdict.reason,
      confirmedAt: null,
      downgradedAt: at,
    };
  }

  if (verdict.kind === 'INCONCLUSIVE') return current;

  // VALID
  const base: AttendanceState =
    current.status === 'VIRTUAL_SUPPORTER'
      ? { ...initialAttendanceState() } // ex-apoiador declarado chegou ao local: recomeça a contagem
      : current;

  const next: AttendanceState = {
    ...base,
    validSampleCount: base.validSampleCount + 1,
    firstValidSampleAt: base.firstValidSampleAt ?? at,
    lastValidSampleAt: at,
  };

  if (next.status === 'PENDING_ON_SITE') {
    const dwellMs = at.getTime() - (next.firstValidSampleAt as Date).getTime();
    if (next.validSampleCount >= cfg.minValidSamples && dwellMs >= cfg.minDwellMs) {
      return { ...next, status: 'CONFIRMED_ON_SITE', confirmedAt: at };
    }
  }
  return next;
}

/** Quando o app pode enviar a próxima amostra que tem chance de confirmar. */
export function nextConfirmationWindow(st: AttendanceState, cfg: PresencePolicyConfig): Date | null {
  if (st.status !== 'PENDING_ON_SITE' || !st.firstValidSampleAt) return null;
  return new Date(st.firstValidSampleAt.getTime() + cfg.minDwellMs);
}

/**
 * Apoio à distância. Idempotente (tocar duas vezes não muda nada) e NUNCA rebaixa
 * quem já foi confirmado no local: a presença física vale mais que o apoio virtual.
 */
export function declareVirtual(current: AttendanceState, at: Date): AttendanceState {
  if (isFraudDowngrade(current)) return current;
  if (current.status === 'CONFIRMED_ON_SITE') return current;
  if (current.status === 'VIRTUAL_SUPPORTER') return current;
  return {
    ...current,
    status: 'VIRTUAL_SUPPORTER',
    virtualReason: 'DECLARED_BY_USER',
    confirmedAt: null,
    downgradedAt: at,
  };
}
