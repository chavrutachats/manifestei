/**
 * Modo padrão: um toque + leituras automáticas a cada 15 min, confirmação com
 * 45 min de permanência, e a linha do tempo do ato (pico, queda, tempo médio).
 * PostgreSQL+PostGIS e Redis reais; só a atestação do Google é simulada.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AndroidIntegrityVerifier, Clock } from '../../src/application/ports.js';
import { DEFAULT_CHECKIN_WINDOW } from '../../src/application/use-cases/presence.js';
import { buildUseCases } from '../../src/container.js';
import { DEFAULT_PRESENCE_POLICY } from '../../src/domain/presence.js';
import { canonicalDeviceRegistration, canonicalPresencePayload } from '../../src/domain/signed-payload.js';
import { AppleAppAttestVerifier } from '../../src/infrastructure/attestation/apple-app-attest.js';
import { RedisChallengeStore, RedisFlagStore } from '../../src/infrastructure/redis.js';
import {
  CryptoIdGenerator,
  HmacAnchorHasher,
  JoseTokenService,
  Sha256PayloadHasher,
} from '../../src/infrastructure/security.js';
import { buildServer } from '../../src/interfaces/http/server.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL;
const run = DB_URL && REDIS_URL ? describe : describe.skip;

const FIVE_MIN = 5 * 60_000;
/** Relógio alinhado em 5 min, para os "baldes" da linha do tempo caírem em horários redondos. */
class FakeClock implements Clock {
  readonly t0 = Math.ceil(Date.now() / FIVE_MIN) * FIVE_MIN;
  private t = this.t0;
  now(): Date {
    return new Date(this.t);
  }
  setMinute(m: number): void {
    this.t = this.t0 + m * 60_000;
  }
  at(m: number): string {
    return new Date(this.t0 + m * 60_000).toISOString();
  }
}

class FakePlayIntegrity implements AndroidIntegrityVerifier {
  async verify(i: { integrityToken: string; expectedRequestHash: string }) {
    const [, , hash] = i.integrityToken.split(':');
    return hash === i.expectedRequestHash ? { ok: true as const } : { ok: false as const, failure: 'BINDING_MISMATCH' as const };
  }
}

const hasher = new Sha256PayloadHasher();
const PAULISTA = { latitude: -23.5614, longitude: -46.6559 };
const OUTSIDE = { latitude: -23.57, longitude: -46.6559 }; // ~950 m ao sul: saiu do ato
const CONSENT = '2026-10';

interface Phone {
  token: string;
  deviceId: string;
  installationId: string;
}

run('permanência automática e linha do tempo (HTTP + PostGIS + Redis)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let redis: Redis;
  const clock = new FakeClock();
  let eventId = '';
  const people: Phone[] = [];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    redis = new Redis(REDIS_URL!);
    await pool.query('TRUNCATE presence_samples, attendance_records, events, devices, sessions, users CASCADE');
    await redis.flushdb();
    const fx = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'app-attest');
    const tokens = new JoseTokenService('x'.repeat(40));
    const useCases = buildUseCases({
      pool,
      clock,
      ids: new CryptoIdGenerator(),
      tokens,
      anchorHasher: new HmacAnchorHasher('p'.repeat(40)),
      payloadHasher: hasher,
      flags: new RedisFlagStore(redis),
      challenges: new RedisChallengeStore(redis),
      ios: new AppleAppAttestVerifier({
        teamId: 'ABCDE12345',
        bundleId: 'br.org.manifestei.app',
        allowDevelopmentEnvironment: true,
        rootCaPem: readFileSync(join(fx, 'root.pem'), 'utf8'),
      }),
      android: new FakePlayIntegrity(),
      policy: DEFAULT_PRESENCE_POLICY, // 2 leituras, 45 min, a cada 15 min
      window: DEFAULT_CHECKIN_WINDOW,
      currentConsentVersion: CONSENT,
      recreateLockSeconds: 26 * 3600,
    });
    app = await buildServer({ useCases, tokens, readiness: async () => undefined, logger: false, disableHttpRateLimit: true });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    redis?.disconnect();
  });

  const post = (url: string, token: string | null, payload?: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const get = (url: string) => app.inject({ method: 'GET', url });

  async function phone(): Promise<Phone> {
    const installationId = randomUUID();
    const deviceAnchor = randomBytes(8).toString('hex');
    const { challenge } = (await post('/v1/enroll/challenge', null, { installationId })).json() as { challenge: string };
    const hash = hasher.sha256Base64(canonicalDeviceRegistration({ platform: 'android', challenge, installationId, deviceAnchor }));
    const res = await post('/v1/enroll', null, {
      platform: 'android',
      installationId,
      deviceAnchor,
      consentVersion: CONSENT,
      challenge,
      attestation: { kind: 'android', integrityToken: `fake:OK:${hash}` },
    });
    const b = res.json() as { accessToken: string; deviceId: string };
    return { token: b.accessToken, deviceId: b.deviceId, installationId };
  }

  /** Uma leitura — o primeiro toque ou uma das automáticas, para o servidor é igual. */
  async function reading(p: Phone, point = PAULISTA) {
    const { challenge } = (await post(`/v1/events/${eventId}/presence/challenge`, p.token)).json() as { challenge: string };
    const location = { ...point, accuracyM: 12, fixTimestampMs: clock.now().getTime() - 1000, isMock: false };
    const hash = hasher.sha256Base64(canonicalPresencePayload({ eventId, challenge, installationId: p.installationId, ...location }));
    const res = await post(`/v1/events/${eventId}/presence`, p.token, {
      deviceId: p.deviceId,
      challenge,
      location,
      attestation: { platform: 'android', integrityToken: `fake:OK:${hash}` },
    });
    return res.json() as { status: string; confirmableAfter: string | null; minDwellMinutes: number; sampleIntervalSeconds: number };
  }

  const counts = async () =>
    ((await get(`/v1/events/${eventId}`)).json() as { counts: { confirmedOnSite: number; pendingOnSite: number } }).counts;
  const group = (from: number, to: number) => people.slice(from, to);

  it('cria o ato e 13 aparelhos', async () => {
    clock.setMinute(0);
    const org = await phone();
    const start = new Date(clock.now().getTime() - 10 * 60_000);
    const res = await post('/v1/events', org.token, {
      title: 'Ato pela educação pública',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 4 * 3600_000).toISOString(),
      area: { kind: 'circle', center: PAULISTA, radiusM: 400 },
    });
    eventId = (res.json() as { id: string }).id;
    for (let k = 0; k < 13; k++) people.push(await phone());
  });

  it('14h00: o primeiro toque deixa a pessoa "em verificação" e informa o ritmo das leituras', async () => {
    for (const p of group(0, 6)) {
      const r = await reading(p);
      expect(r).toMatchObject({ status: 'PENDING_ON_SITE', minDwellMinutes: 45, sampleIntervalSeconds: 900 });
      expect(r.confirmableAfter).toBe(clock.at(45));
    }
    expect(await counts()).toMatchObject({ confirmedOnSite: 0, pendingOnSite: 6 });
  });

  it('leituras automáticas: confirma só depois de 45 min no local', async () => {
    clock.setMinute(15);
    for (const p of group(0, 6)) expect((await reading(p)).status).toBe('PENDING_ON_SITE');
    for (const p of group(6, 12)) await reading(p); // segundo grupo chega às 14h15
    clock.setMinute(30);
    for (const p of group(0, 12)) expect((await reading(p)).status).toBe('PENDING_ON_SITE');
    clock.setMinute(45);
    for (const p of group(0, 6)) expect((await reading(p)).status).toBe('CONFIRMED_ON_SITE');
    for (const p of group(6, 12)) expect((await reading(p)).status).toBe('PENDING_ON_SITE');
    expect(await counts()).toMatchObject({ confirmedOnSite: 6, pendingOnSite: 6 });
  });

  it('as pessoas vão embora em horários diferentes; as leituras continuam até saírem', async () => {
    clock.setMinute(60);
    for (const p of group(0, 3)) await reading(p, OUTSIDE); // saíram entre 14h45 e 15h00
    for (const p of group(3, 12)) await reading(p);
    clock.setMinute(75);
    for (const p of group(3, 6)) await reading(p, OUTSIDE);
    for (const p of group(6, 12)) await reading(p);
    clock.setMinute(90);
    for (const p of group(6, 12)) await reading(p);
    await reading(people[12]!); // chegou às 15h30...
    clock.setMinute(105);
    for (const p of group(6, 9)) await reading(p, OUTSIDE);
    for (const p of group(9, 12)) await reading(p);
    await reading(people[12]!, OUTSIDE); // ...e foi embora antes de 45 min: nunca confirmada
    clock.setMinute(120);
    for (const p of group(9, 12)) await reading(p, OUTSIDE);
    expect(await counts()).toMatchObject({ confirmedOnSite: 12, pendingOnSite: 1 });
  });

  it('linha do tempo: pico às 14h15, queda a partir de 14h55, média de 75 min', async () => {
    clock.setMinute(130);
    const tl = (await get(`/v1/events/${eventId}/timeline`)).json() as {
      suppressed: boolean;
      people: number;
      series: Array<{ at: string; onSite: number }>;
      peak: { at: string; onSite: number };
      declineStartedAt: string;
      averageStayMinutes: number;
      medianStayMinutes: number;
    };
    expect(tl.suppressed).toBe(false);
    expect(tl.people).toBe(12); // quem não ficou 45 min não entra
    expect(tl.peak).toEqual({ at: clock.at(15), onSite: 12 });
    expect(tl.declineStartedAt).toBe(clock.at(55)); // grupo 1: última leitura 14h45 + 7,5 min
    // estadias: 3×52,5 + 3×67,5 + 3×82,5 + 3×97,5 = 900 → 75 min
    expect(tl.averageStayMinutes).toBe(75);
    expect(tl.medianStayMinutes).toBe(75);
    const onSiteAt = (m: number) => tl.series.find((p) => p.at === clock.at(m))?.onSite;
    expect([onSiteAt(-10), onSiteAt(0), onSiteAt(15), onSiteAt(55), onSiteAt(70), onSiteAt(100), onSiteAt(115)]).toEqual([
      0, 6, 12, 9, 6, 3, 0,
    ]);
    // nada individual sai na resposta
    expect(JSON.stringify(tl)).not.toMatch(/deviceId|userId|latitude/);
  });

  it('ato pequeno: a linha do tempo não é publicada', async () => {
    const org = await phone();
    const start = new Date(clock.now().getTime() - 10 * 60_000);
    const small = (
      await post('/v1/events', org.token, {
        title: 'Vigília pequena no bairro',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3600_000).toISOString(),
        area: { kind: 'circle', center: PAULISTA, radiusM: 100 },
      })
    ).json() as { id: string };
    const tl = (await get(`/v1/events/${small.id}/timeline`)).json() as { suppressed: boolean; series: unknown[]; peak: unknown };
    expect(tl).toMatchObject({ suppressed: true, series: [], peak: null });
  });
});
