import { describe, expect, it } from 'vitest';
import { computeTimeline, type PresenceInterval } from '../../src/domain/timeline.js';

const T0 = new Date('2026-11-15T14:00:00Z').getTime();
const at = (min: number) => new Date(T0 + min * 60_000);
const iv = (arrive: number, last: number): PresenceInterval => ({ arrivedAt: at(arrive), lastSeenAt: at(last) });
const base = { bucketMs: 5 * 60_000, sampleIntervalMs: 15 * 60_000, minPeople: 10 };
const times = (n: number, arrive: number, last: number) => Array.from({ length: n }, () => iv(arrive, last));

describe('linha do tempo do ato', () => {
  // 3 grupos: chegam 14h00/14h15, saem em horários diferentes
  const intervals = [...times(6, 0, 45), ...times(4, 15, 90), ...times(2, 15, 105)];
  const tl = computeTimeline({ ...base, intervals, from: at(-10), to: at(240), now: at(180) });

  it('presença estimada: da chegada até a última leitura + meio intervalo (7,5 min)', () => {
    if (tl.suppressed) throw new Error('não deveria suprimir');
    const onSiteAt = (m: number) => tl.series.find((p) => p.at.getTime() === at(m).getTime())!.onSite;
    expect(onSiteAt(-5)).toBe(0);
    expect(onSiteAt(0)).toBe(6);
    expect(onSiteAt(15)).toBe(12);
    expect(onSiteAt(50)).toBe(12); // grupo 1 sai às 52,5
    expect(onSiteAt(55)).toBe(6);
    expect(onSiteAt(95)).toBe(6); // grupo 2 sai às 97,5
    expect(onSiteAt(100)).toBe(2);
    expect(onSiteAt(115)).toBe(0); // grupo 3 sai às 112,5
  });

  it('pico, início da queda e permanência média/mediana', () => {
    if (tl.suppressed) throw new Error('não deveria suprimir');
    expect(tl.peak).toEqual({ at: at(15), onSite: 12 });
    expect(tl.declineStartedAt).toEqual(at(55));
    // 6×52,5 + 4×82,5 + 2×97,5 = 840 → 70 min
    expect(tl.averageStayMs / 60_000).toBeCloseTo(70, 5);
    expect(tl.medianStayMs / 60_000).toBeCloseTo((52.5 + 82.5) / 2, 5);
  });

  it('a série termina em "agora" durante o ato e não inventa futuro', () => {
    const live = computeTimeline({ ...base, intervals, from: at(-10), to: at(240), now: at(30) });
    if (live.suppressed) throw new Error('não deveria suprimir');
    expect(live.series.at(-1)!.at).toEqual(at(30));
    expect(live.declineStartedAt).toBeNull(); // ainda no pico
  });

  it('quem ainda está no ato conta até agora, não até a última leitura + 7,5 min no futuro', () => {
    const live = computeTimeline({ ...base, intervals: times(10, 0, 28), from: at(0), to: at(240), now: at(30) });
    if (live.suppressed) throw new Error('não deveria suprimir');
    expect(live.averageStayMs / 60_000).toBeCloseTo(30, 5);
  });

  it('pico que se repete: a queda conta a partir da ÚLTIMA vez no pico', () => {
    const tl2 = computeTimeline({
      ...base,
      intervals: [...times(10, 0, 20), ...times(10, 40, 60)],
      from: at(0),
      to: at(120),
      now: at(120),
    });
    if (tl2.suppressed) throw new Error('não deveria suprimir');
    expect(tl2.peak.onSite).toBe(10);
    expect(tl2.peak.at).toEqual(at(0));
    expect(tl2.declineStartedAt).toEqual(at(70)); // segundo grupo sai às 67,5
  });

  it('com poucas pessoas a linha do tempo não é publicada (horários poderiam identificá-las)', () => {
    expect(computeTimeline({ ...base, intervals: times(9, 0, 60), from: at(0), to: at(90), now: at(90) })).toEqual({
      suppressed: true,
      people: 9,
      minPeople: 10,
    });
  });
});
