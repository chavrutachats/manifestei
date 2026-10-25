import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import type { ChallengeStore, ExpiringFlagStore } from '../application/ports.js';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableAutoPipelining: true, lazyConnect: false });
}

/**
 * Desafios de 256 bits, guardados com TTL e consumidos com GETDEL (atômico):
 * duas requisições com o mesmo desafio → só a primeira passa.
 */
export class RedisChallengeStore implements ChallengeStore {
  constructor(private readonly redis: Redis) {}

  async issue(scope: string, ttlSeconds: number): Promise<string> {
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(`ch:${scope}:${challenge}`, '1', 'EX', ttlSeconds);
    return challenge;
  }

  async consume(scope: string, challenge: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
    return (await this.redis.getdel(`ch:${scope}:${challenge}`)) === '1';
  }
}

export class RedisFlagStore implements ExpiringFlagStore {
  constructor(private readonly redis: Redis) {}

  async set(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`flag:${key}`, '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(`flag:${key}`)) === 1;
  }
}
