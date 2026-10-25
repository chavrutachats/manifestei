/**
 * Teste de ponta a ponta contra PostgreSQL+PostGIS e Redis reais, via HTTP.
 * Só a atestação do Google é simulada (FakePlayIntegrity), mantendo a mesma
 * regra de vínculo: o token só é válido para o hash do payload exato.
 *
 *   TEST_DATABASE_URL=postgres://... TEST_REDIS_URL=redis://... npm run test:integration
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
import { ONE_TAP_PRESENCE_POLICY } from '../../src/domain/presence.js';
import { canonicalDeviceRegistration, canonicalPresencePayload } from '../../src/domain/signed-payload.js';
import { AppleAppAttestVerifier } from '../../src/infrastructure/attestation/apple-app-attest.js';
import { purgeExpiredPresenceData } from '../../src/infrastructure/jobs/purge-locations.js';
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

class FakeClock implements Clock {
  constructor(private t: number) {}
  now(): Date {
    return new Date(this.t);
  }
  advanceMinutes(m: number): void {
    this.t += m * 60_000;
  }
}

/** Token simulado: "fake:<VEREDITO>:<requestHash>". O vínculo com o payload é checado como no Google. */
class FakePlayIntegrity implements AndroidIntegrityVerifier {
  async verify(i: { integrityToken: string; expectedRequestHash: string }) {
    const [, verdict, hash] = i.integrityToken.split(':');
    if (hash !== i.expectedRequestHash) return { ok: false as const, failure: 'BINDING_MISMATCH' as const };
    if (verdict === 'EMULATOR') return { ok: false as const, failure: 'DEVICE_INTEGRITY' as const };
    if (verdict === 'DOWN') return { ok: false as const, failure: 'PROVIDER_UNAVAILABLE' as const };
    return { ok: true as const };
  }
}

const hasher = new Sha256PayloadHasher();
const PAULISTA = { latitude: -23.5614, longitude: -46.6559 };
const RIO = { latitude: -22.9068, longitude: -43.1729 };
const CONSENT = '2026-10';

/** ANDROID_ID: 16 dígitos hex, estável por aparelho+app. */
const newAnchor = () => randomBytes(8).toString('hex');

interface Phone {
  token: string;
  refreshToken: string;
  userId: string;
  deviceId: string;
  installationId: string;
  anchor: string;
}

run('identidade, fraude e contagem — modo um toque (HTTP + PostGIS + Redis)', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let redis: Redis;
  const clock = new FakeClock(Date.now());
  let eventId = '';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    redis = new Redis(REDIS_URL!);
    await pool.query('TRUNCATE presence_samples, attendance_records, events, devices, sessions, users CASCADE');
    await redis.flushdb();

    const fxDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'app-attest');
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
        rootCaPem: readFileSync(join(fxDir, 'root.pem'), 'utf8'),
      }),
      android: new FakePlayIntegrity(),
      policy: ONE_TAP_PRESENCE_POLICY,
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

  // ---------------- helpers ----------------
  const post = (url: string, token: string | null, payload?: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const get = (url: string, token: string | null = null) =>
    app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  /** Abrir o app pela primeira vez: aceitar o termo e o aparelho se matricula sozinho. */
  async function enrollRaw(o: { anchor?: string; verdict?: 'OK' | 'EMULATOR'; installationId?: string; consent?: string } = {}) {
    const installationId = o.installationId ?? randomUUID();
    const anchor = o.anchor ?? newAnchor();
    const { challenge } = (await post('/v1/enroll/challenge', null, { installationId })).json() as { challenge: string };
    const hash = hasher.sha256Base64(
      canonicalDeviceRegistration({ platform: 'android', challenge, installationId, deviceAnchor: anchor }),
    );
    const res = await post('/v1/enroll', null, {
      platform: 'android',
      installationId,
      deviceAnchor: anchor,
      consentVersion: o.consent ?? CONSENT,
      challenge,
      attestation: { kind: 'android', integrityToken: `fake:${o.verdict ?? 'OK'}:${hash}` },
    });
    return { res, installationId, anchor };
  }

  async function phone(o: { anchor?: string; installationId?: string } = {}): Promise<Phone> {
    const { res, installationId, anchor } = await enrollRaw(o);
    expect(res.statusCode).toBe(200);
    const b = res.json() as { accessToken: string; refreshToken: string; userId: string; deviceId: string };
    return { token: b.accessToken, refreshToken: b.refreshToken, userId: b.userId, deviceId: b.deviceId, installationId, anchor };
  }

  interface TapOpts {
    point?: { latitude: number; longitude: number };
    isMock?: boolean;
    verdict?: 'OK' | 'EMULATOR' | 'DOWN';
    tamperAfterSigning?: boolean;
    reuseChallenge?: string;
  }

  /** Tocar em "Estou no ato". */
  async function tap(p: Phone, o: TapOpts = {}, ev: string = eventId) {
    const challenge =
      o.reuseChallenge ?? ((await post(`/v1/events/${ev}/presence/challenge`, p.token)).json() as { challenge: string }).challenge;
    const location = {
      latitude: (o.point ?? PAULISTA).latitude,
      longitude: (o.point ?? PAULISTA).longitude,
      accuracyM: 10,
      fixTimestampMs: clock.now().getTime() - 1500,
      isMock: o.isMock ?? false,
    };
    const signed = canonicalPresencePayload({ eventId: ev, challenge, installationId: p.installationId, ...location });
    const hash = hasher.sha256Base64(signed);
    // "app adulterado": assina uma coordenada e envia outra
    const sent = o.tamperAfterSigning ? { ...location, latitude: location.latitude + 0.01 } : location;
    const res = await post(`/v1/events/${ev}/presence`, p.token, {
      deviceId: p.deviceId,
      challenge,
      location: sent,
      attestation: { platform: 'android', integrityToken: `fake:${o.verdict ?? 'OK'}:${hash}` },
    });
    return {
      res,
      challenge,
      body: res.json() as Record<string, unknown> & { sample?: { verdict: string; reason: string | null; distanceToAreaM: number | null } },
    };
  }

  /** Tocar em "Apoiar à distância". */
  const support = async (p: Phone, ev: string = eventId) => (await post(`/v1/events/${ev}/virtual-support`, p.token)).json();

  interface Counts {
    confirmedOnSite: number;
    pendingOnSite: number;
    virtualSupporters: number;
    downgradedForFraud: number;
  }
  const counts = async (ev = eventId) => ((await get(`/v1/events/${ev}`)).json() as { counts: Counts }).counts;

  async function createEvent(p: Phone, area: unknown, title = 'Ato pela educação pública') {
    const start = new Date(clock.now().getTime() - 10 * 60_000);
    return post('/v1/events', p.token, {
      title,
      description: 'Concentração no MASP.',
      city: 'São Paulo',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 4 * 3600_000).toISOString(),
      area,
    });
  }

  // ---------------- identidade ----------------
  it('não há cadastro: sem aceitar o termo vigente, o aparelho não se matricula', async () => {
    const { res } = await enrollRaw({ consent: '2020-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'CONSENT_REQUIRED' });
  });

  it('emulador não ganha identidade e não entra em nenhuma contagem', async () => {
    const { res } = await enrollRaw({ verdict: 'EMULATOR' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'DEVICE_NOT_TRUSTED' });
  });

  it('organizador não pode desenhar uma área do tamanho de um bairro', async () => {
    const p = await phone();
    expect((await createEvent(p, { kind: 'circle', center: PAULISTA, radiusM: 5000 })).statusCode).toBe(400);
    expect((await createEvent(p, { kind: 'route', path: [PAULISTA, RIO], widthM: 100 })).statusCode).toBe(400);
  });

  it('organizador cria um ato com área circular', async () => {
    const res = await createEvent(await phone(), { kind: 'circle', center: PAULISTA, radiusM: 400 });
    expect(res.statusCode).toBe(201);
    eventId = (res.json() as { id: string }).id;

    const ev = (await get(`/v1/events/${eventId}`)).json() as Record<string, unknown>;
    expect(ev.phase).toBe('LIVE');
    expect(ev).not.toHaveProperty('organizerId');
    expect((ev.area as { type: string }).type).toBe('Polygon');
    const integrity = ev.integrity as { areaM2: number; capacityAnomaly: boolean };
    expect(integrity.areaM2).toBeGreaterThan(495_000);
    expect(integrity.areaM2).toBeLessThan(505_000);
    expect(integrity.capacityAnomaly).toBe(false);
  });

  // ---------------- um toque ----------------
  let u1: Phone;

  it('um toque em "Estou no ato" confirma a presença na hora', async () => {
    u1 = await phone();
    expect((await get('/v1/me', u1.token)).json()).toMatchObject({ device: { trust: 'TRUSTED', canConfirmOnSite: true } });
    const r = await tap(u1);
    expect(r.res.statusCode).toBe(200);
    expect(r.body).toMatchObject({ status: 'CONFIRMED_ON_SITE', sample: { verdict: 'VALID' } });
    expect((await counts()).confirmedOnSite).toBe(1);
  });

  it('tocar de novo não conta de novo', async () => {
    expect((await tap(u1)).body.status).toBe('CONFIRMED_ON_SITE');
    expect((await counts()).confirmedOnSite).toBe(1);
  });

  it('reinstalar o app devolve a MESMA identidade (mesmo aparelho) e não conta de novo', async () => {
    const reinstalled = await phone({ anchor: u1.anchor }); // nova instalação, mesmo ANDROID_ID
    expect(reinstalled.userId).toBe(u1.userId);
    expect(reinstalled.installationId).not.toBe(u1.installationId);
    expect((await tap(reinstalled)).body.status).toBe('CONFIRMED_ON_SITE');
    expect((await counts()).confirmedOnSite).toBe(1);
    // a sessão da instalação antiga deixou de valer
    expect((await post('/v1/auth/refresh', null, { refreshToken: u1.refreshToken })).statusCode).toBe(401);
  });

  // ---------------- fraude ----------------
  it('GPS falso → apoio virtual, definitivo mesmo com toques limpos depois', async () => {
    const p = await phone();
    expect((await tap(p, { isMock: true })).body).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'MOCK_LOCATION' });
    clock.advanceMinutes(1);
    expect((await tap(p)).body).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'MOCK_LOCATION' });
  });

  it('coordenada alterada depois de assinada → PAYLOAD_TAMPERED', async () => {
    const p = await phone();
    expect((await tap(p, { tamperAfterSigning: true })).body).toMatchObject({
      status: 'VIRTUAL_SUPPORTER',
      virtualReason: 'PAYLOAD_TAMPERED',
    });
  });

  it('replay do mesmo desafio é recusado sem mexer no estado', async () => {
    const p = await phone();
    const first = await tap(p);
    expect(first.body.status).toBe('CONFIRMED_ON_SITE');
    const replay = await tap(p, { reuseChallenge: first.challenge });
    expect(replay.res.statusCode).toBe(409);
    expect(replay.body).toMatchObject({ error: 'CHALLENGE_INVALID' });
  });

  // ---------------- leitura ruim não pune ----------------
  it('fora da área: não conta, não pune e informa a distância', async () => {
    const p = await phone();
    const r = await tap(p, { point: { latitude: -23.57, longitude: -46.6559 } }); // ~950 m ao sul
    expect(r.body).toMatchObject({ status: 'NONE', sample: { verdict: 'INCONCLUSIVE', reason: 'OUTSIDE_AREA' } });
    expect(r.body.sample!.distanceToAreaM).toBeGreaterThan(400);
    expect(r.body.sample!.distanceToAreaM).toBeLessThan(700);
  });

  it('Google indisponível: não conta e não pune', async () => {
    const p = await phone();
    const r = await tap(p, { verdict: 'DOWN' });
    expect(r.body).toMatchObject({ status: 'NONE', sample: { reason: 'ATTESTATION_PROVIDER_UNAVAILABLE' } });
  });

  // ---------------- velocidade impossível ----------------
  it('teletransporte Rio → São Paulo em 1 minuto → IMPOSSIBLE_TRAVEL', async () => {
    const p = await phone();
    await tap(p, { point: RIO }); // fora da área, mas fica como referência
    clock.advanceMinutes(1);
    expect((await tap(p)).body).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'IMPOSSIBLE_TRAVEL' });
  });

  let rioEventId = '';
  it('teletransporte ENTRE atos: confirmado em SP e, 1 min depois, num ato no Rio', async () => {
    const res = await createEvent(await phone(), { kind: 'circle', center: RIO, radiusM: 300 }, 'Ato no Rio de Janeiro');
    rioEventId = (res.json() as { id: string }).id;
    const p = await phone();
    expect((await tap(p)).body.status).toBe('CONFIRMED_ON_SITE'); // Paulista, ato de SP
    clock.advanceMinutes(1);
    expect((await tap(p, { point: RIO }, rioEventId)).body).toMatchObject({
      status: 'VIRTUAL_SUPPORTER',
      virtualReason: 'IMPOSSIBLE_TRAVEL',
    });
  });

  // ---------------- apoio à distância ----------------
  it('apoio à distância: um toque, e tocar de novo não conta de novo', async () => {
    const p = await phone();
    const before = await counts();
    expect(await support(p)).toMatchObject({ status: 'VIRTUAL_SUPPORTER', virtualReason: 'DECLARED_BY_USER' });
    expect(await support(p)).toMatchObject({ status: 'VIRTUAL_SUPPORTER' });
    const after = await counts();
    expect(after.virtualSupporters).toBe(before.virtualSupporters + 1);
    expect(after.confirmedOnSite).toBe(before.confirmedOnSite);
  });

  it('quem apoiou à distância e depois chegou ao ato passa a contar como presente', async () => {
    const p = await phone();
    await support(p);
    const before = await counts();
    expect((await tap(p)).body.status).toBe('CONFIRMED_ON_SITE');
    const after = await counts();
    expect(after.virtualSupporters).toBe(before.virtualSupporters - 1);
    expect(after.confirmedOnSite).toBe(before.confirmedOnSite + 1);
  });

  it('quem está confirmado no local não vira apoio virtual por engano', async () => {
    const p = await phone();
    await tap(p);
    const before = await counts();
    expect(await support(p)).toMatchObject({ status: 'CONFIRMED_ON_SITE' });
    expect(await counts()).toEqual(before);
  });

  it('contagem final separa rigidamente presentes e apoio virtual', async () => {
    // presentes: u1, replay, SP→Rio (em SP), virtual→presente, confirmado→apoio
    // virtual: 3 rebaixados (GPS falso, adulterado, teletransporte) + 1 declarado
    expect(await counts()).toEqual({ confirmedOnSite: 5, pendingOnSite: 0, virtualSupporters: 4, downgradedForFraud: 3 });
    expect(await counts(rioEventId)).toEqual({ confirmedOnSite: 0, pendingOnSite: 0, virtualSupporters: 1, downgradedForFraud: 1 });
  });

  // ---------------- privacidade ----------------
  it('apagar meus dados: o aparelho some, a contagem fica, e não dá para "voltar" na hora', async () => {
    const p = await phone();
    expect((await tap(p)).body.status).toBe('CONFIRMED_ON_SITE');
    const before = await counts();

    const del = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${p.token}` } });
    expect(del.statusCode).toBe(204);
    expect(await counts()).toEqual(before);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM presence_samples s JOIN attendance_records a ON a.id = s.attendance_id
        WHERE a.user_id IS NULL AND (s.location IS NOT NULL OR s.installation_id IS NOT NULL)`,
    );
    expect(rows[0].n).toBe(0);

    expect((await get('/v1/me', p.token)).statusCode).toBe(401);
    const again = await enrollRaw({ anchor: p.anchor });
    expect(again.res.statusCode).toBe(429); // impediria contar o mesmo aparelho duas vezes
  });

  it('o banco não guarda nenhum identificador de aparelho em claro', async () => {
    const { rows } = await pool.query<{ anchor_hash: string }>('SELECT anchor_hash FROM users');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.anchor_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify((await pool.query('SELECT * FROM users')).rows);
    expect(dump).not.toContain(u1.anchor);
  });

  it('retenção: depois do ato sobram só chegada e última leitura; nenhuma leitura individual', async () => {
    const before = await counts();
    await pool.query(`UPDATE events SET ends_at = now() - interval '5 days', starts_at = now() - interval '5 days 2 hours'`);
    expect(await purgeExpiredPresenceData(pool, 72)).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM presence_samples');
    expect(rows[0].n).toBe(0);
    expect(await counts()).toEqual(before); // os totais não dependem das leituras
  });

  it('rotas protegidas exigem token', async () => {
    expect((await post(`/v1/events/${eventId}/presence/challenge`, null)).statusCode).toBe(401);
    expect((await post(`/v1/events/${eventId}/virtual-support`, 'lixo')).statusCode).toBe(401);
  });
});
