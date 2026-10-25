import type { AttendanceCounts, EventAreaInput, ProtestEvent } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import { areaIntegrity, validateArea, type AreaIntegrity } from '../../domain/event-area.js';
import type { Clock, EventRepository, IdGenerator } from '../ports.js';

export interface EventWithCounts extends ProtestEvent {
  counts: AttendanceCounts;
  integrity: AreaIntegrity;
  phase: 'UPCOMING' | 'LIVE' | 'ENDED' | 'CANCELLED';
}

const withCounts = (e: ProtestEvent, counts: AttendanceCounts, now: Date): EventWithCounts => ({
  ...e,
  counts,
  integrity: areaIntegrity(e.areaM2, counts.confirmedOnSite + counts.pendingOnSite),
  phase: eventPhase(e, now),
});

const EMPTY_COUNTS: AttendanceCounts = { confirmedOnSite: 0, pendingOnSite: 0, virtualSupporters: 0, downgradedForFraud: 0 };

export interface CreateEventInput {
  organizerId: string;
  title: string;
  description: string;
  city: string | null;
  startsAt: Date;
  endsAt: Date;
  area: EventAreaInput;
}

const MAX_EVENTS_PER_DAY = 5;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export function eventPhase(e: ProtestEvent, now: Date): EventWithCounts['phase'] {
  if (e.status === 'CANCELLED') return 'CANCELLED';
  if (now < e.startsAt) return 'UPCOMING';
  if (now <= e.endsAt) return 'LIVE';
  return 'ENDED';
}

export class CreateEvent {
  constructor(private readonly d: { events: EventRepository; ids: IdGenerator; clock: Clock }) {}

  async execute(input: CreateEventInput): Promise<{ id: string }> {
    const now = this.d.clock.now();
    const title = input.title.trim();
    if (title.length < 5 || title.length > 120) throw new DomainError('VALIDATION', 'Título deve ter de 5 a 120 caracteres.');
    if (input.description.length > 4000) throw new DomainError('VALIDATION', 'Descrição muito longa.');
    if (input.endsAt <= input.startsAt) throw new DomainError('VALIDATION', 'Término deve ser após o início.');
    if (input.endsAt.getTime() - input.startsAt.getTime() > MAX_DURATION_MS) {
      throw new DomainError('VALIDATION', 'Um evento pode durar no máximo 24 horas.');
    }
    if (input.endsAt <= now) throw new DomainError('VALIDATION', 'O evento já terminou.');
    if (input.startsAt.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
      throw new DomainError('VALIDATION', 'Eventos podem ser agendados com até 1 ano de antecedência.');
    }
    validateArea(input.area);

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if ((await this.d.events.countCreatedBy(input.organizerId, since)) >= MAX_EVENTS_PER_DAY) {
      throw new DomainError('RATE_LIMITED', 'Limite de eventos criados nas últimas 24 h atingido.');
    }

    const id = this.d.ids.uuid();
    await this.d.events.insert({
      id,
      organizerId: input.organizerId,
      title,
      description: input.description.trim(),
      city: input.city?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      area: input.area,
    });
    return { id };
  }
}

export class ListEvents {
  constructor(private readonly d: { events: EventRepository; clock: Clock }) {}

  async execute(input: { limit?: number }): Promise<EventWithCounts[]> {
    const now = this.d.clock.now();
    const events = await this.d.events.listActiveOrUpcoming(now, Math.min(input.limit ?? 50, 100));
    const counts = await this.d.events.countsMany(events.map((e) => e.id));
    return events.map((e) => withCounts(e, counts.get(e.id) ?? EMPTY_COUNTS, now));
  }
}

export class GetEvent {
  constructor(private readonly d: { events: EventRepository; clock: Clock }) {}

  async execute(input: { eventId: string }): Promise<EventWithCounts> {
    const e = await this.d.events.findById(input.eventId);
    if (!e) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');
    return withCounts(e, await this.d.events.counts(e.id), this.d.clock.now());
  }
}

export class CancelEvent {
  constructor(private readonly d: { events: EventRepository; clock: Clock }) {}

  async execute(input: { eventId: string; userId: string }): Promise<void> {
    const e = await this.d.events.findById(input.eventId);
    if (!e) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');
    if (e.organizerId !== input.userId) throw new DomainError('FORBIDDEN', 'Só quem criou o evento pode cancelá-lo.');
    if (e.status === 'CANCELLED') return;
    if (e.endsAt <= this.d.clock.now()) throw new DomainError('EVENT_CLOSED', 'Evento já encerrado.');
    await this.d.events.cancel(e.id);
  }
}
