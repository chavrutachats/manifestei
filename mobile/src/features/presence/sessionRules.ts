import type { PresenceSampleResult, PresenceStatus } from '../../domain/types';

/**
 * Regras da sessão automática de presença — funções puras, sem nada de nativo,
 * testadas em scripts/verify-session-rules.ts.
 */

export const RETRY_SOON_MS = 5 * 60_000;
export const OUTSIDE_READINGS_TO_STOP = 2;
export const CHECK_IN_CLOSES_AFTER_END_MS = 30 * 60_000;

export type SessionEndReason = 'LEFT_AREA' | 'EVENT_ENDED' | 'STOPPED_BY_USER' | 'DOWNGRADED' | 'PERMISSION' | 'DEVICE_UNTRUSTED';

export interface PresenceSession {
  eventId: string;
  eventTitle: string;
  startedAt: number;
  closesAt: number;
  intervalMs: number;
  nextReadingAt: number;
  lastReadingAt: number | null;
  lastStatus: PresenceStatus | 'NONE';
  consecutiveOutside: number;
  /** Última mensagem para a tela (GPS fraco, sem rede etc.). */
  notice: string | null;
  ended: { reason: SessionEndReason; at: number } | null;
}

/** Decide o próximo passo a partir do veredito do servidor. */
export function applyResult(s: PresenceSession, r: PresenceSampleResult, now: number): PresenceSession {
  const base = { ...s, lastReadingAt: now, lastStatus: r.status };
  const { verdict, reason } = r.sample;

  if (verdict === 'VALID') {
    return { ...base, consecutiveOutside: 0, notice: null, nextReadingAt: now + s.intervalMs };
  }
  if (verdict === 'FRAUD' || (r.status === 'VIRTUAL_SUPPORTER' && r.virtualReason !== 'DECLARED_BY_USER')) {
    return { ...base, notice: null, ended: { reason: 'DOWNGRADED', at: now } };
  }
  if (reason === 'OUTSIDE_AREA') {
    const outside = s.consecutiveOutside + 1;
    if (outside >= OUTSIDE_READINGS_TO_STOP) {
      return { ...base, consecutiveOutside: outside, notice: null, ended: { reason: 'LEFT_AREA', at: now } };
    }
    // pode ter sido só uma volta pela quadra: confere de novo daqui a pouco
    return { ...base, consecutiveOutside: outside, notice: null, nextReadingAt: now + RETRY_SOON_MS };
  }
  if (reason === 'OUTSIDE_TIME_WINDOW') {
    return { ...base, ended: { reason: 'EVENT_ENDED', at: now } };
  }
  // GPS fraco, fix atrasado, Apple/Google fora do ar: tenta de novo logo, sem punir
  return { ...base, nextReadingAt: now + RETRY_SOON_MS };
}
