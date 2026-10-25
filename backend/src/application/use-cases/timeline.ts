import { DomainError } from '../../domain/errors.js';
import type { PresencePolicyConfig } from '../../domain/presence.js';
import { computeTimeline, type Timeline } from '../../domain/timeline.js';
import type { Clock, EventRepository } from '../ports.js';
import type { CheckInWindowConfig } from './presence.js';

const BUCKET_MS = 5 * 60_000;
/** Abaixo de 10 pessoas confirmadas, horários de chegada/saída poderiam identificar alguém. */
export const MIN_PEOPLE_FOR_TIMELINE = 10;
/** Muitas pessoas consultando ao mesmo tempo: recalcula no máximo a cada 30 s por ato e instância. */
const CACHE_MS = 30_000;

export interface TimelineView {
  eventId: string;
  people: number;
  suppressed: boolean;
  minPeople: number;
  bucketMinutes: number;
  sampleIntervalMinutes: number;
  series: Array<{ at: string; onSite: number }>;
  peak: { at: string; onSite: number } | null;
  declineStartedAt: string | null;
  averageStayMinutes: number | null;
  medianStayMinutes: number | null;
}

/**
 * Pico de presentes, início da queda e tempo médio de permanência.
 * Público e agregado: nunca expõe intervalos individuais.
 */
export class GetEventTimeline {
  private readonly cache = new Map<string, { at: number; view: TimelineView }>();

  constructor(
    private readonly d: { events: EventRepository; clock: Clock; policy: PresencePolicyConfig; window: CheckInWindowConfig },
  ) {}

  async execute(input: { eventId: string }): Promise<TimelineView> {
    const now = this.d.clock.now();
    const hit = this.cache.get(input.eventId);
    if (hit && now.getTime() - hit.at < CACHE_MS) return hit.view;

    const event = await this.d.events.findById(input.eventId);
    if (!event) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');

    const tl = computeTimeline({
      intervals: await this.d.events.presenceIntervals(event.id),
      from: new Date(Math.min(event.startsAt.getTime(), now.getTime())),
      to: new Date(event.endsAt.getTime() + this.d.window.closesAfterEndMs),
      now,
      bucketMs: BUCKET_MS,
      sampleIntervalMs: this.d.policy.sampleIntervalMs,
      minPeople: MIN_PEOPLE_FOR_TIMELINE,
    });
    const view = toView(event.id, tl, this.d.policy);
    this.cache.set(input.eventId, { at: now.getTime(), view });
    if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
    return view;
  }
}

const minutes = (ms: number) => Math.round(ms / 60_000);

function toView(eventId: string, tl: Timeline, policy: PresencePolicyConfig): TimelineView {
  const common = {
    eventId,
    people: tl.people,
    minPeople: MIN_PEOPLE_FOR_TIMELINE,
    bucketMinutes: minutes(BUCKET_MS),
    sampleIntervalMinutes: minutes(policy.sampleIntervalMs),
  };
  if (tl.suppressed) {
    return { ...common, suppressed: true, series: [], peak: null, declineStartedAt: null, averageStayMinutes: null, medianStayMinutes: null };
  }
  return {
    ...common,
    suppressed: false,
    series: tl.series.map((p) => ({ at: p.at.toISOString(), onSite: p.onSite })),
    peak: { at: tl.peak.at.toISOString(), onSite: tl.peak.onSite },
    declineStartedAt: tl.declineStartedAt?.toISOString() ?? null,
    averageStayMinutes: minutes(tl.averageStayMs),
    medianStayMinutes: minutes(tl.medianStayMs),
  };
}
