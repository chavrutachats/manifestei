import type pg from 'pg';
import type {
  AttendanceReadRepository,
  AttendanceTxRepository,
  TransactionRunner,
} from '../../application/ports.js';
import type { AttendanceRecord, PresenceSample } from '../../domain/entities.js';
import type { PresenceStatus, VirtualReason } from '../../domain/presence.js';
import { withTransaction, type Queryable } from './pool.js';

interface AttendanceRow {
  id: string;
  event_id: string;
  user_id: string | null;
  status: PresenceStatus;
  virtual_reason: VirtualReason | null;
  valid_sample_count: number;
  first_valid_sample_at: Date | null;
  last_valid_sample_at: Date | null;
  confirmed_at: Date | null;
  downgraded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const toRecord = (r: AttendanceRow): AttendanceRecord => ({
  id: r.id,
  eventId: r.event_id,
  userId: r.user_id,
  status: r.status,
  virtualReason: r.virtual_reason,
  validSampleCount: r.valid_sample_count,
  firstValidSampleAt: r.first_valid_sample_at,
  lastValidSampleAt: r.last_valid_sample_at,
  confirmedAt: r.confirmed_at,
  downgradedAt: r.downgraded_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

class PgAttendanceTxRepository implements AttendanceTxRepository {
  constructor(private readonly db: Queryable) {}

  async lockInstallation(installationId: string): Promise<void> {
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`installation:${installationId}`]);
  }

  async lockOrCreate(initial: AttendanceRecord): Promise<AttendanceRecord> {
    await this.db.query(
      `INSERT INTO attendance_records (
         id, event_id, user_id, status, virtual_reason, valid_sample_count,
         first_valid_sample_at, last_valid_sample_at, confirmed_at, downgraded_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [
        initial.id,
        initial.eventId,
        initial.userId,
        initial.status,
        initial.virtualReason,
        initial.validSampleCount,
        initial.firstValidSampleAt,
        initial.lastValidSampleAt,
        initial.confirmedAt,
        initial.downgradedAt,
        initial.createdAt,
        initial.updatedAt,
      ],
    );
    const { rows } = await this.db.query<AttendanceRow>(
      'SELECT * FROM attendance_records WHERE event_id = $1 AND user_id = $2 FOR UPDATE',
      [initial.eventId, initial.userId],
    );
    if (!rows[0]) throw new Error('Registro de presença não encontrado após INSERT');
    return toRecord(rows[0]);
  }

  async update(r: AttendanceRecord): Promise<void> {
    await this.db.query(
      `UPDATE attendance_records SET
         status = $2, virtual_reason = $3, valid_sample_count = $4,
         first_valid_sample_at = $5, last_valid_sample_at = $6,
         confirmed_at = $7, downgraded_at = $8, updated_at = $9
       WHERE id = $1`,
      [
        r.id,
        r.status,
        r.virtualReason,
        r.validSampleCount,
        r.firstValidSampleAt,
        r.lastValidSampleAt,
        r.confirmedAt,
        r.downgradedAt,
        r.updatedAt,
      ],
    );
  }

  async lastSampleForUser(userId: string): Promise<PresenceSample | null> {
    const { rows } = await this.db.query<{
      id: string;
      attendance_id: string;
      device_id: string;
      installation_id: string;
      received_at: Date;
      fix_timestamp: Date;
      lat: number;
      lon: number;
      accuracy_m: number;
      distance_to_area_m: number;
      verdict: PresenceSample['verdict'];
      reason: string | null;
    }>(
      `SELECT s.id, s.attendance_id, s.device_id, s.installation_id, s.received_at, s.fix_timestamp,
              ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lon,
              s.accuracy_m, s.distance_to_area_m, s.verdict, s.reason
       FROM presence_samples s
       JOIN attendance_records a ON a.id = s.attendance_id
       WHERE a.user_id = $1 AND s.location IS NOT NULL
       ORDER BY s.received_at DESC
       LIMIT 1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      attendanceId: r.attendance_id,
      deviceId: r.device_id,
      installationId: r.installation_id,
      receivedAt: r.received_at,
      fixTimestamp: r.fix_timestamp,
      location: { latitude: Number(r.lat), longitude: Number(r.lon) },
      accuracyM: Number(r.accuracy_m),
      distanceToAreaM: Number(r.distance_to_area_m),
      verdict: r.verdict,
      reason: r.reason,
    };
  }

  async insertSample(s: PresenceSample): Promise<void> {
    await this.db.query(
      `INSERT INTO presence_samples (
         id, attendance_id, device_id, installation_id, received_at, fix_timestamp,
         location, accuracy_m, distance_to_area_m, verdict, reason
       ) VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9,$10,$11,$12)`,
      [
        s.id,
        s.attendanceId,
        s.deviceId,
        s.installationId,
        s.receivedAt,
        s.fixTimestamp,
        s.location.longitude,
        s.location.latitude,
        s.accuracyM,
        s.distanceToAreaM,
        s.verdict,
        s.reason,
      ],
    );
  }

  async installationValidatedForOtherUser(eventId: string, installationId: string, userId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1
       FROM presence_samples s
       JOIN attendance_records a ON a.id = s.attendance_id
       WHERE s.installation_id = $2 AND s.verdict = 'VALID'
         AND a.event_id = $1 AND a.user_id <> $3
       LIMIT 1`,
      [eventId, installationId, userId],
    );
    return rows.length > 0;
  }
}

export class PgTransactionRunner implements TransactionRunner {
  constructor(private readonly pool: pg.Pool) {}
  run<T>(fn: (tx: { attendance: AttendanceTxRepository }) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (client) => fn({ attendance: new PgAttendanceTxRepository(client) }));
  }
}

export class PgAttendanceReadRepository implements AttendanceReadRepository {
  constructor(private readonly pool: pg.Pool) {}
  async find(eventId: string, userId: string): Promise<AttendanceRecord | null> {
    const { rows } = await this.pool.query<AttendanceRow>(
      'SELECT * FROM attendance_records WHERE event_id = $1 AND user_id = $2',
      [eventId, userId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }
}
