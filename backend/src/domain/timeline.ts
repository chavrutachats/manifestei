/**
 * Linha do tempo de um ato: quantas pessoas estavam no local a cada momento,
 * quando foi o pico, quando começou a esvaziar e quanto tempo as pessoas ficaram.
 *
 * Entrada: só DOIS horários por pessoa confirmada — a primeira e a última leitura
 * válida no local. Nenhuma coordenada é usada. Função pura (sem I/O).
 *
 * Estimativa da saída: a pessoa saiu em algum momento entre a última leitura
 * válida e a seguinte (que não aconteceu ou deu "fora da área"). Usamos o ponto
 * médio: última leitura + metade do intervalo de amostragem. É o estimador sem
 * viés para um intervalo uniforme e mantém o erro em ±½ intervalo (±7,5 min no padrão).
 */

export interface PresenceInterval {
  arrivedAt: Date;
  lastSeenAt: Date;
}

export interface TimelineInput {
  intervals: PresenceInterval[];
  /** Início da janela (normalmente o início do ato). */
  from: Date;
  /** Fim da janela (fim do ato + tolerância, ou agora, o que vier primeiro). */
  to: Date;
  now: Date;
  bucketMs: number;
  sampleIntervalMs: number;
  /** Abaixo disso a linha do tempo não é publicada (horários de poucas pessoas podem identificá-las). */
  minPeople: number;
}

export interface TimelinePoint {
  at: Date;
  onSite: number;
}

export type Timeline =
  | { suppressed: true; people: number; minPeople: number }
  | {
      suppressed: false;
      people: number;
      bucketMs: number;
      series: TimelinePoint[];
      peak: TimelinePoint;
      /** Primeiro momento abaixo do pico, depois da última vez em que o pico foi atingido. null = ainda no pico. */
      declineStartedAt: Date | null;
      averageStayMs: number;
      medianStayMs: number;
    };

/** Arredonda para baixo no múltiplo de `step` (ex.: 16h07 → 16h05). */
export const floorTo = (d: Date, step: number): Date => new Date(Math.floor(d.getTime() / step) * step);

export function computeTimeline(i: TimelineInput): Timeline {
  const people = i.intervals.length;
  if (people < i.minPeople) return { suppressed: true, people, minPeople: i.minPeople };

  const half = i.sampleIntervalMs / 2;
  const spans = i.intervals.map((iv) => ({
    start: iv.arrivedAt.getTime(),
    // nunca além de "agora": quem ainda está no ato conta até o momento presente
    end: Math.max(iv.arrivedAt.getTime(), Math.min(iv.lastSeenAt.getTime() + half, i.now.getTime())),
  }));

  const from = floorTo(i.from, i.bucketMs).getTime();
  const to = Math.max(from, Math.min(i.to.getTime(), i.now.getTime()));
  const n = Math.floor((to - from) / i.bucketMs) + 1;

  // Varredura com vetor de diferenças: O(pessoas + intervalos de tempo), não O(pessoas × intervalos).
  const diff = new Int32Array(n + 1);
  for (const sp of spans) {
    const first = Math.max(0, Math.ceil((sp.start - from) / i.bucketMs));
    const last = Math.min(n - 1, Math.floor((sp.end - from) / i.bucketMs));
    if (first > last) continue;
    diff[first]! += 1;
    diff[last + 1]! -= 1;
  }

  const series: TimelinePoint[] = [];
  let running = 0;
  let peakIdx = 0;
  let lastPeakIdx = 0;
  for (let k = 0; k < n; k++) {
    running += diff[k]!;
    series.push({ at: new Date(from + k * i.bucketMs), onSite: running });
    const peakValue = series[peakIdx]!.onSite;
    if (running > peakValue) {
      peakIdx = k;
      lastPeakIdx = k;
    } else if (running === peakValue && running > 0) {
      lastPeakIdx = k;
    }
  }

  const peak = series[peakIdx]!;
  const after = series[lastPeakIdx + 1];
  const declineStartedAt = peak.onSite > 0 && after && after.onSite < peak.onSite ? after.at : null;

  const stays = spans.map((s) => s.end - s.start).sort((a, b) => a - b);
  const averageStayMs = stays.reduce((a, b) => a + b, 0) / stays.length;
  const mid = Math.floor(stays.length / 2);
  const medianStayMs = stays.length % 2 ? stays[mid]! : (stays[mid - 1]! + stays[mid]!) / 2;

  return { suppressed: false, people, bucketMs: i.bucketMs, series, peak, declineStartedAt, averageStayMs, medianStayMs };
}
