/**
 * Regras da sessão automática (sem celular): quando ler de novo, quando parar.
 *   npm run verify:session
 */
import assert from 'node:assert/strict';
import { RETRY_SOON_MS, applyResult, type PresenceSession } from '../src/features/presence/sessionRules.ts';
import type { PresenceSampleResult } from '../src/domain/types.ts';

const MIN = 60_000;
const t0 = 1_800_000_000_000;
const session: PresenceSession = {
  eventId: 'e', eventTitle: 'Ato', startedAt: t0, closesAt: t0 + 5 * 60 * MIN, intervalMs: 15 * MIN,
  nextReadingAt: t0 + 15 * MIN, lastReadingAt: t0, lastStatus: 'PENDING_ON_SITE', consecutiveOutside: 0, notice: null, ended: null,
};
const result = (status: PresenceSampleResult['status'], verdict: PresenceSampleResult['sample']['verdict'], reason: PresenceSampleResult['sample']['reason'] = null, virtualReason: PresenceSampleResult['virtualReason'] = null): PresenceSampleResult => ({
  eventId: 'e', status, virtualReason, validSampleCount: 2, requiredSamples: 2, confirmableAfter: null, minDwellMinutes: 45,
  sampleIntervalSeconds: 900, sample: { verdict, reason, distanceToAreaM: null },
});

// leitura válida: próxima em 15 min, zera "fora da área"
let s = applyResult({ ...session, consecutiveOutside: 1 }, result('PENDING_ON_SITE', 'VALID'), t0 + 15 * MIN);
assert.equal(s.nextReadingAt, t0 + 30 * MIN);
assert.equal(s.consecutiveOutside, 0);
assert.equal(s.ended, null);

// confirmado: continua lendo (para medir permanência)
s = applyResult(s, result('CONFIRMED_ON_SITE', 'VALID'), t0 + 45 * MIN);
assert.equal(s.lastStatus, 'CONFIRMED_ON_SITE');
assert.equal(s.ended, null);
assert.equal(s.nextReadingAt, t0 + 60 * MIN);

// uma leitura fora da área: confere de novo em 5 min, sem encerrar
s = applyResult(s, result('CONFIRMED_ON_SITE', 'INCONCLUSIVE', 'OUTSIDE_AREA'), t0 + 60 * MIN);
assert.equal(s.ended, null);
assert.equal(s.nextReadingAt, t0 + 60 * MIN + RETRY_SOON_MS);

// segunda seguida fora: saiu do ato, encerra
s = applyResult(s, result('CONFIRMED_ON_SITE', 'INCONCLUSIVE', 'OUTSIDE_AREA'), t0 + 65 * MIN);
assert.equal(s.ended?.reason, 'LEFT_AREA');

// GPS fraco não encerra nem pune
s = applyResult(session, result('PENDING_ON_SITE', 'INCONCLUSIVE', 'LOW_ACCURACY'), t0 + 15 * MIN);
assert.equal(s.ended, null);
assert.equal(s.nextReadingAt, t0 + 15 * MIN + RETRY_SOON_MS);

// fraude: encerra
s = applyResult(session, result('VIRTUAL_SUPPORTER', 'FRAUD', 'MOCK_LOCATION', 'MOCK_LOCATION'), t0 + 15 * MIN);
assert.equal(s.ended?.reason, 'DOWNGRADED');

// fora do horário do ato: encerra
s = applyResult(session, result('PENDING_ON_SITE', 'INCONCLUSIVE', 'OUTSIDE_TIME_WINDOW'), t0 + 15 * MIN);
assert.equal(s.ended?.reason, 'EVENT_ENDED');

console.log('regras da sessão OK');
