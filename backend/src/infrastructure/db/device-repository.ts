import type pg from 'pg';
import type { DeviceRepository } from '../../application/ports.js';
import type { Device } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import { withTransaction } from './pool.js';

const isUniqueViolation = (err: unknown): boolean => (err as { code?: string }).code === '23505';

interface DeviceRow {
  id: string;
  user_id: string;
  platform: 'ios' | 'android';
  installation_id: string;
  trust: 'TRUSTED' | 'UNTRUSTED';
  untrusted_reason: string | null;
  app_attest_key_id: string | null;
  app_attest_public_key_pem: string | null;
  app_attest_sign_count: string; // bigint chega como string
  app_attest_environment: 'production' | 'development' | null;
  active: boolean;
  created_at: Date;
}

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.user_id,
  platform: r.platform,
  installationId: r.installation_id,
  trust: r.trust,
  untrustedReason: r.untrusted_reason,
  appAttest:
    r.app_attest_key_id && r.app_attest_public_key_pem && r.app_attest_environment
      ? {
          keyId: r.app_attest_key_id,
          publicKeyPem: r.app_attest_public_key_pem,
          signCount: Number(r.app_attest_sign_count),
          environment: r.app_attest_environment,
        }
      : null,
  active: r.active,
  createdAt: r.created_at,
});

export class PgDeviceRepository implements DeviceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<Device | null> {
    const { rows } = await this.pool.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [id]);
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async findActiveByUser(userId: string): Promise<Device | null> {
    const { rows } = await this.pool.query<DeviceRow>('SELECT * FROM devices WHERE user_id = $1 AND active', [userId]);
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async replaceActiveDevice(d: Device, receipt?: Buffer): Promise<void> {
    try {
      await this.insertReplacing(d, receipt);
    } catch (err) {
      // Mesma chave App Attest apresentada duas vezes: uma chave do Secure Enclave
      // pertence a UMA instalação; reaproveitá-la é replay de atestação.
      if (isUniqueViolation(err)) throw new DomainError('CONFLICT', 'Chave de atestação já registrada.');
      throw err;
    }
  }

  private async insertReplacing(d: Device, receipt?: Buffer): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      await c.query('UPDATE devices SET active = false WHERE user_id = $1 AND active', [d.userId]);
      await c.query(
        `INSERT INTO devices (
           id, user_id, platform, installation_id, trust, untrusted_reason,
           app_attest_key_id, app_attest_public_key_pem, app_attest_sign_count,
           app_attest_environment, app_attest_receipt, active, created_at, last_seen_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$12)`,
        [
          d.id,
          d.userId,
          d.platform,
          d.installationId,
          d.trust,
          d.untrustedReason,
          d.appAttest?.keyId ?? null,
          d.appAttest?.publicKeyPem ?? null,
          d.appAttest?.signCount ?? 0,
          d.appAttest?.environment ?? null,
          receipt ?? null,
          d.createdAt,
        ],
      );
    });
  }

  async advanceSignCount(deviceId: string, newCount: number): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE devices SET app_attest_sign_count = $2 WHERE id = $1 AND app_attest_sign_count < $2',
      [deviceId, newCount],
    );
    return res.rowCount === 1;
  }

  async touch(deviceId: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE devices SET last_seen_at = $2 WHERE id = $1', [deviceId, at]);
  }
}
