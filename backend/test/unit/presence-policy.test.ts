import { describe, expect, it } from 'vitest';
import {
  ONE_TAP_PRESENCE_POLICY as cfg,
  DEFAULT_PRESENCE_POLICY as dwell,
  applyVerdict,
  declareVirtual,
  evaluateSample,
  initialAttendanceState,
  type SampleSignals,
} from '../../src/domain/presence.js';

const good: SampleSignals = {
  attestation: { ok: true },
  isMockLocation: false,
  accuracyM: 12,
  distanceToAreaM: 0,
  withinEventWindow: true,
  fixAgeMs: 2_000,
  impliedSpeedMps: 1.2,
  deviceUsedByAnotherUser: false,
};

const t0 = new Date('2026-11-15T14:00:00Z');
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);

describe('evaluateSample', () => {
  it('aceita amostra limpa dentro da área', () => {
    expect(evaluateSample(good, cfg)).toEqual({ kind: 'VALID' });
  });

  it.each([
    ['DEVICE_INTEGRITY', 'DEVICE_INTEGRITY_FAILED'],
    ['APP_INTEGRITY', 'APP_INTEGRITY_FAILED'],
    ['BINDING_MISMATCH', 'PAYLOAD_TAMPERED'],
    ['INVALID', 'ATTESTATION_INVALID'],
    ['UNSUPPORTED', 'UNTRUSTED_DEVICE'],
  ] as const)('falha de atestação %s → fraude %s', (failure, reason) => {
    expect(evaluateSample({ ...good, attestation: { ok: false, failure } }, cfg)).toEqual({ kind: 'FRAUD', reason });
  });

  it('indisponibilidade do Google/Apple NÃO pune o usuário', () => {
    expect(evaluateSample({ ...good, attestation: { ok: false, failure: 'PROVIDER_UNAVAILABLE' } }, cfg)).toEqual({
      kind: 'INCONCLUSIVE',
      reason: 'ATTESTATION_PROVIDER_UNAVAILABLE',
    });
  });

  it('localização simulada é fraude mesmo fora da área (fraude tem precedência)', () => {
    expect(evaluateSample({ ...good, isMockLocation: true, distanceToAreaM: 9_000 }, cfg)).toEqual({
      kind: 'FRAUD',
      reason: 'MOCK_LOCATION',
    });
  });

  it('teletransporte é fraude', () => {
    expect(evaluateSample({ ...good, impliedSpeedMps: 300 }, cfg)).toEqual({ kind: 'FRAUD', reason: 'IMPOSSIBLE_TRAVEL' });
  });

  it('aparelho já usado por outro usuário no mesmo evento é fraude', () => {
    expect(evaluateSample({ ...good, deviceUsedByAnotherUser: true }, cfg)).toEqual({ kind: 'FRAUD', reason: 'DEVICE_SHARED' });
  });

  it.each([
    [{ accuracyM: 80 }, 'LOW_ACCURACY'],
    [{ distanceToAreaM: 400 }, 'OUTSIDE_AREA'],
    [{ withinEventWindow: false }, 'OUTSIDE_TIME_WINDOW'],
    [{ fixAgeMs: 10 * 60_000 }, 'STALE_OR_SKEWED_FIX'],
    [{ fixAgeMs: -5 * 60_000 }, 'STALE_OR_SKEWED_FIX'],
  ] as const)('%o → inconclusiva %s', (patch, reason) => {
    expect(evaluateSample({ ...good, ...patch }, cfg)).toEqual({ kind: 'INCONCLUSIVE', reason });
  });

  it('tolera borda da área até min(precisão, tolerância)', () => {
    expect(evaluateSample({ ...good, accuracyM: 30, distanceToAreaM: 20 }, cfg).kind).toBe('VALID');
    expect(evaluateSample({ ...good, accuracyM: 10, distanceToAreaM: 20 }, cfg).kind).toBe('INCONCLUSIVE');
  });
});

describe('applyVerdict — modo um toque', () => {
  it('a primeira leitura válida já confirma a presença', () => {
    const st = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, cfg);
    expect(st).toMatchObject({ status: 'CONFIRMED_ON_SITE', confirmedAt: t0, validSampleCount: 1 });
  });

  it('leitura inconclusiva (fora da área) não confirma nem pune', () => {
    const st = applyVerdict(initialAttendanceState(), { kind: 'INCONCLUSIVE', reason: 'OUTSIDE_AREA' }, t0, cfg);
    expect(st).toEqual(initialAttendanceState());
  });

  it('fraude no primeiro toque vira apoio virtual definitivo', () => {
    let st = applyVerdict(initialAttendanceState(), { kind: 'FRAUD', reason: 'MOCK_LOCATION' }, t0, cfg);
    st = applyVerdict(st, { kind: 'VALID' }, plus(5), cfg);
    expect(st).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'MOCK_LOCATION' });
  });

  it('apoio virtual é idempotente e nunca rebaixa quem esteve no local', () => {
    const virtual = declareVirtual(initialAttendanceState(), t0);
    expect(declareVirtual(virtual, plus(1))).toEqual(virtual);

    const onSite = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, cfg);
    expect(declareVirtual(onSite, plus(1))).toEqual(onSite);
  });

  it('quem apoiou à distância e depois foi ao ato passa a contar como presente', () => {
    const st = applyVerdict(declareVirtual(initialAttendanceState(), t0), { kind: 'VALID' }, plus(30), cfg);
    expect(st).toMatchObject({ status: 'CONFIRMED_ON_SITE', virtualReason: null });
  });
});

describe('applyVerdict — padrão: permanência (2 leituras, 45 min)', () => {
  it('confirma só após N amostras válidas E tempo mínimo de permanência', () => {
    let st = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, dwell);
    expect(st.status).toBe('PENDING_ON_SITE');

    st = applyVerdict(st, { kind: 'VALID' }, plus(15), dwell); // 2 amostras, mas só 15 min
    expect(st.status).toBe('PENDING_ON_SITE');
    st = applyVerdict(st, { kind: 'VALID' }, plus(30), dwell);
    expect(st.status).toBe('PENDING_ON_SITE');

    st = applyVerdict(st, { kind: 'VALID' }, plus(45), dwell);
    expect(st.status).toBe('CONFIRMED_ON_SITE');
    expect(st.confirmedAt).toEqual(plus(45));
  });

  it('fraude rebaixa até quem já estava confirmado', () => {
    let st = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, dwell);
    st = applyVerdict(st, { kind: 'VALID' }, plus(46), dwell);
    expect(st.status).toBe('CONFIRMED_ON_SITE');
    st = applyVerdict(st, { kind: 'FRAUD', reason: 'MOCK_LOCATION' }, plus(60), dwell);
    expect(st).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'MOCK_LOCATION', confirmedAt: null });
  });

  it('rebaixamento por fraude é definitivo no evento', () => {
    let st = applyVerdict(initialAttendanceState(), { kind: 'FRAUD', reason: 'DEVICE_INTEGRITY_FAILED' }, t0, dwell);
    for (let m = 1; m <= 30; m += 5) st = applyVerdict(st, { kind: 'VALID' }, plus(m), dwell);
    expect(st).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'DEVICE_INTEGRITY_FAILED' });
    expect(declareVirtual(st, plus(40)).virtualReason).toBe('DEVICE_INTEGRITY_FAILED');
  });

  it('apoiador virtual DECLARADO pode depois comprovar presença', () => {
    let st = declareVirtual(initialAttendanceState(), t0);
    st = applyVerdict(st, { kind: 'VALID' }, plus(1), dwell);
    expect(st).toMatchObject({ status: 'PENDING_ON_SITE', validSampleCount: 1, virtualReason: null });
    st = applyVerdict(st, { kind: 'VALID' }, plus(50), dwell);
    expect(st.status).toBe('CONFIRMED_ON_SITE');
  });

  it('leituras depois de confirmar continuam marcando até quando a pessoa ficou', () => {
    let st = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, dwell);
    st = applyVerdict(st, { kind: 'VALID' }, plus(45), dwell);
    st = applyVerdict(st, { kind: 'VALID' }, plus(120), dwell);
    expect(st).toMatchObject({ status: 'CONFIRMED_ON_SITE', confirmedAt: plus(45), firstValidSampleAt: t0, lastValidSampleAt: plus(120) });
    // saiu da área: a leitura não vale e a última presença registrada continua em 120 min
    st = applyVerdict(st, { kind: 'INCONCLUSIVE', reason: 'OUTSIDE_AREA' }, plus(135), dwell);
    expect(st.lastValidSampleAt).toEqual(plus(120));
  });

  it('amostra inconclusiva não altera estado', () => {
    const st = applyVerdict(initialAttendanceState(), { kind: 'VALID' }, t0, dwell);
    expect(applyVerdict(st, { kind: 'INCONCLUSIVE', reason: 'OUTSIDE_AREA' }, plus(5), dwell)).toEqual(st);
  });
});
