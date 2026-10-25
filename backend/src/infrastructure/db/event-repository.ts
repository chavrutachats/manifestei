import type pg from 'pg';
import type { EventRepository, Geofence, NewEvent } from '../../application/ports.js';
import type { AttendanceCounts, ProtestEvent } from '../../domain/entities.js';
import type { GeoPoint } from '../../domain/geo.js';

interface EventRow {
  id: string;
  organizer_id: string | null;
  title: string;
  description: string;
  city: string | null;
  starts_at: Date;
  ends_at: Date;
  area_kind: 'circle' | 'route';
  area_geojson: string;
  area_m2: number;
  status: 'SCHEDULED' | 'CANCELLED';
  created_at: Date;
}

const EVENT_COLUMNS = `
  id, organizer_id, title, description, city, starts_at, ends_at, area_kind,
  ST_AsGeoJSON(area, 6) AS area_geojson, ST_Area(area) AS area_m2, status, created_at`;

const toEvent = (r: EventRow): ProtestEvent => ({
  id: r.id,
  organizerId: r.organizer_id,
  title: r.title,
  description: r.description,
  city: r.city,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  areaKind: r.area_kind,
  areaGeoJson: JSON.parse(r.area_geojson) as unknown,
  areaM2: Number(r.area_m2),
  status: r.status,
  createdAt: r.created_at,
});

const emptyCounts = (): AttendanceCounts => ({
  confirmedOnSite: 0,
  pendingOnSite: 0,
  virtualSupporters: 0,
  downgradedForFraud: 0,
});

export class PgEventRepository implements EventRepository, Geofence {
  constructor(private readonly pool: pg.Pool) {}

  async insert(e: NewEvent): Promise<void> {
    // A área é construída pelo PostGIS em metros reais (geography), não em graus.
    const areaSql =
      e.area.kind === 'circle'
        ? `ST_Buffer(ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography, $11)`
        : `ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON($9), 4326)::geography, $10)`;

    const areaParams =
      e.area.kind === 'circle'
        ? [e.area.center.longitude, e.area.center.latitude, e.area.radiusM]
        : [
            JSON.stringify({
              type: 'LineString',
              coordinates: e.area.path.map((p: GeoPoint) => [p.longitude, p.latitude]),
            }),
            e.area.widthM / 2,
          ];

    await this.pool.query(
      `INSERT INTO events (id, organizer_id, title, description, city, starts_at, ends_at, area, area_kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${areaSql}, $8)`,
      [e.id, e.organizerId, e.title, e.description, e.city, e.startsAt, e.endsAt, e.area.kind, ...areaParams],
    );
  }

  async findById(id: string): Promise<ProtestEvent | null> {
    const { rows } = await this.pool.query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`, [id]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async listActiveOrUpcoming(now: Date, limit: number): Promise<ProtestEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events
       WHERE status = 'SCHEDULED' AND ends_at >= $1
       ORDER BY starts_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return rows.map(toEvent);
  }

  async cancel(id: string): Promise<void> {
    await this.pool.query(`UPDATE events SET status = 'CANCELLED' WHERE id = $1`, [id]);
  }

  async counts(eventId: string): Promise<AttendanceCounts> {
    return (await this.countsMany([eventId])).get(eventId) ?? emptyCounts();
  }

  async countsMany(eventIds: string[]): Promise<Map<string, AttendanceCounts>> {
    const result = new Map<string, AttendanceCounts>();
    if (eventIds.length === 0) return result;
    // Uma única passada com FILTER: as quatro contagens saem do mesmo snapshot.
    const { rows } = await this.pool.query<{
      event_id: string;
      confirmed: string;
      pending: string;
      virtual: string;
      downgraded: string;
    }>(
      `SELECT event_id,
              count(*) FILTER (WHERE status = 'CONFIRMED_ON_SITE') AS confirmed,
              count(*) FILTER (WHERE status = 'PENDING_ON_SITE' AND valid_sample_count > 0) AS pending,
              count(*) FILTER (WHERE status = 'VIRTUAL_SUPPORTER') AS virtual,
              count(*) FILTER (WHERE status = 'VIRTUAL_SUPPORTER'
                                 AND virtual_reason <> 'DECLARED_BY_USER') AS downgraded
       FROM attendance_records
       WHERE event_id = ANY($1::uuid[])
       GROUP BY event_id`,
      [eventIds],
    );
    for (const r of rows) {
      result.set(r.event_id, {
        confirmedOnSite: Number(r.confirmed),
        pendingOnSite: Number(r.pending),
        virtualSupporters: Number(r.virtual),
        downgradedForFraud: Number(r.downgraded),
      });
    }
    return result;
  }

  async countCreatedBy(organizerId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM events WHERE organizer_id = $1 AND created_at >= $2',
      [organizerId, since],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async presenceIntervals(eventId: string): Promise<Array<{ arrivedAt: Date; lastSeenAt: Date }>> {
    const { rows } = await this.pool.query<{ first_valid_sample_at: Date; last_valid_sample_at: Date }>(
      `SELECT first_valid_sample_at, last_valid_sample_at
         FROM attendance_records
        WHERE event_id = $1 AND status = 'CONFIRMED_ON_SITE'
          AND first_valid_sample_at IS NOT NULL AND last_valid_sample_at IS NOT NULL`,
      [eventId],
    );
    return rows.map((r) => ({ arrivedAt: r.first_valid_sample_at, lastSeenAt: r.last_valid_sample_at }));
  }

  /** Geocerca: ST_Distance em geography devolve metros e é 0 para pontos dentro do polígono. */
  async distanceToEventArea(eventId: string, point: GeoPoint): Promise<number> {
    const { rows } = await this.pool.query<{ d: number }>(
      `SELECT ST_Distance(area, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS d
       FROM events WHERE id = $1`,
      [eventId, point.longitude, point.latitude],
    );
    if (!rows[0]) throw new Error(`Evento ${eventId} não encontrado para geocerca`);
    return Number(rows[0].d);
  }
}
