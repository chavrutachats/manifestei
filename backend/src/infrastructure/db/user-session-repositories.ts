import type pg from 'pg';
import type { AccountRepository, SessionRepository, UserRepository } from '../../application/ports.js';
import type { Session, User } from '../../domain/entities.js';
import { withTransaction } from './pool.js';

interface UserRow {
  id: string;
  anchor_hash: string;
  display_name: string | null;
  consent_version: string;
  consented_at: Date;
  created_at: Date;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  anchorHash: r.anchor_hash,
  displayName: r.display_name,
  consentVersion: r.consent_version,
  consentedAt: r.consented_at,
  createdAt: r.created_at,
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findByAnchorHash(anchorHash: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE anchor_hash = $1', [anchorHash]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async insert(u: User): Promise<void> {
    // ON CONFLICT: dois logins simultâneos do mesmo telefone não derrubam a requisição
    await this.pool.query(
      `INSERT INTO users (id, anchor_hash, display_name, consent_version, consented_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (anchor_hash) DO NOTHING`,
      [u.id, u.anchorHash, u.displayName, u.consentVersion, u.consentedAt, u.createdAt],
    );
  }

  async updateConsent(userId: string, version: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE users SET consent_version = $2, consented_at = $3 WHERE id = $1', [
      userId,
      version,
      at,
    ]);
  }
}

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly pool: pg.Pool) {}

  async deleteAndAnonymize(userId: string): Promise<void> {
    await withTransaction(this.pool, async (c) => {
      // 1. amostras: some a coordenada e qualquer identificador de aparelho
      await c.query(
        `UPDATE presence_samples s
            SET location = NULL, location_purged_at = now(), device_id = NULL, installation_id = NULL
           FROM attendance_records a
          WHERE s.attendance_id = a.id AND a.user_id = $1`,
        [userId],
      );
      // 2. presença: o status (e portanto a contagem) fica; o dono não
      await c.query('UPDATE attendance_records SET user_id = NULL, updated_at = now() WHERE user_id = $1', [userId]);
      // 3. usuário: sessions e devices caem por ON DELETE CASCADE; events.organizer_id → NULL
      await c.query('DELETE FROM users WHERE id = $1', [userId]);
    });
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  userId: r.user_id,
  refreshTokenHash: r.refresh_token_hash,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insert(s: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, revoked_at) VALUES ($1, $2, $3, $4, $5)`,
      [s.id, s.userId, s.refreshTokenHash, s.expiresAt, s.revokedAt],
    );
  }

  async findByRefreshHash(hash: string): Promise<Session | null> {
    const { rows } = await this.pool.query<SessionRow>('SELECT * FROM sessions WHERE refresh_token_hash = $1', [hash]);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async findById(id: string): Promise<Session | null> {
    const { rows } = await this.pool.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async rotate(id: string, newHash: string, newExpiresAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET refresh_token_hash = $2, expires_at = $3, rotated_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id, newHash, newExpiresAt],
    );
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at]);
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, at]);
  }
}
