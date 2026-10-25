import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ZodError } from 'zod';
import type { AccessClaims, TokenService } from '../../application/ports.js';
import type { DeleteAccount, GetMe } from '../../application/use-cases/account.js';
import type { GetEventTimeline } from '../../application/use-cases/timeline.js';
import { createHash } from 'node:crypto';
import type { EnrollDevice, IssueEnrollmentChallenge, RefreshSession } from '../../application/use-cases/auth.js';
import type { CancelEvent, CreateEvent, EventWithCounts, GetEvent, ListEvents } from '../../application/use-cases/events.js';
import type {
  DeclareVirtualSupport,
  GetMyAttendance,
  IssuePresenceChallenge,
  SubmitPresenceSample,
} from '../../application/use-cases/presence.js';
import { DomainError, type DomainErrorCode } from '../../domain/errors.js';
import * as S from './schemas.js';

export interface UseCases {
  issueEnrollmentChallenge: IssueEnrollmentChallenge;
  enrollDevice: EnrollDevice;
  refreshSession: RefreshSession;
  createEvent: CreateEvent;
  listEvents: ListEvents;
  getEvent: GetEvent;
  cancelEvent: CancelEvent;
  issuePresenceChallenge: IssuePresenceChallenge;
  submitPresenceSample: SubmitPresenceSample;
  declareVirtualSupport: DeclareVirtualSupport;
  getMyAttendance: GetMyAttendance;
  getMe: GetMe;
  deleteAccount: DeleteAccount;
  getEventTimeline: GetEventTimeline;
}

export interface ServerDeps {
  useCases: UseCases;
  tokens: TokenService;
  /** Reaproveita o próprio Redis para o rate limit HTTP (contagem compartilhada entre réplicas). */
  redis?: Redis;
  readiness: () => Promise<void>;
  logLevel?: string;
  trustProxy?: boolean;
  logger?: boolean;
  /** Somente testes automatizados. */
  disableHttpRateLimit?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessClaims | null;
  }
}

/**
 * Chave do rate limit. Numa manifestação, milhares de celulares saem pela MESMA
 * operadora atrás de poucos IPs (CGNAT): limitar por IP derrubaria o ato inteiro.
 * Requisições autenticadas são limitadas por sessão; só as anônimas, por IP.
 */
function rateLimitKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return `tok:${createHash('sha256').update(auth.slice(7)).digest('base64url').slice(0, 22)}`;
  }
  return `ip:${req.ip}`;
}

/** Leituras públicas (lista e totais) devem ficar atrás de CDN/cache; este teto é só proteção. */
const PUBLIC_READ_LIMIT = { rateLimit: { max: 6000, timeWindow: '1 minute' } };

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  CONSENT_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  DEVICE_NOT_TRUSTED: 403,
  DEVICE_NOT_REGISTERED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CHALLENGE_INVALID: 409,
  EVENT_CLOSED: 409,
  RATE_LIMITED: 429,
  ATTESTATION_UNAVAILABLE: 503,
};

/** Representação pública de um evento: nunca expõe quem organizou nem quem participa. */
function serializeEvent(e: EventWithCounts) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    city: e.city,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    areaKind: e.areaKind,
    area: e.areaGeoJson,
    phase: e.phase,
    counts: e.counts,
    integrity: e.integrity,
  };
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 64 * 1024,
    logger:
      deps.logger === false
        ? false
        : {
            level: deps.logLevel ?? 'info',
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
  });

  await app.register(helmet, { global: true });
  if (!deps.disableHttpRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      keyGenerator: rateLimitKey,
      ...(deps.redis ? { redis: deps.redis, nameSpace: 'rl-http:' } : {}),
    });
  }

  app.decorateRequest('auth', null);

  const authenticate = async (req: FastifyRequest): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError('UNAUTHENTICATED', 'Token ausente.');
    req.auth = await deps.tokens.verifyAccessToken(header.slice(7));
  };
  const userId = (req: FastifyRequest): string => {
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Token ausente.');
    return req.auth.userId;
  };

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof DomainError) {
      return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION',
        message: 'Dados inválidos.',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.status(429).send({ error: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde um pouco.' });
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'BAD_REQUEST', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Erro interno.' });
  });

  const uc = deps.useCases;

  // ---------------- saúde ----------------
  app.get('/health/live', { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get('/health/ready', { config: { rateLimit: false } }, async () => {
    await deps.readiness();
    return { ok: true };
  });

  // ---------------- identidade do aparelho (sem cadastro) ----------------
  // Anônimo por definição: limite por IP generoso (CGNAT), a atestação é a barreira real.
  const enrollLimit = { rateLimit: { max: 600, timeWindow: '1 minute' } };

  app.post('/v1/enroll/challenge', { config: enrollLimit }, async (req) => {
    return uc.issueEnrollmentChallenge.execute(S.EnrollChallengeBody.parse(req.body));
  });

  app.post('/v1/enroll', { config: enrollLimit }, async (req) => {
    return uc.enrollDevice.execute(S.EnrollBody.parse(req.body));
  });

  app.post('/v1/auth/refresh', { config: enrollLimit }, async (req) => {
    return uc.refreshSession.execute(S.RefreshBody.parse(req.body));
  });

  // ---------------- conta ----------------
  app.get('/v1/me', { preHandler: authenticate }, async (req) => uc.getMe.execute({ userId: userId(req) }));

  app.delete('/v1/me', { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    await uc.deleteAccount.execute({ userId: userId(req) });
    return reply.status(204).send();
  });

  // ---------------- eventos ----------------
  app.get('/v1/events', { config: PUBLIC_READ_LIMIT }, async (req) => {
    const q = S.ListEventsQuery.parse(req.query);
    const events = await uc.listEvents.execute({ limit: q.limit });
    return { events: events.map(serializeEvent) };
  });

  app.get('/v1/events/:eventId', { config: PUBLIC_READ_LIMIT }, async (req) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    return serializeEvent(await uc.getEvent.execute({ eventId }));
  });

  // Pico, queda e permanência. Agregado e público; cacheável por CDN.
  app.get('/v1/events/:eventId/timeline', { config: PUBLIC_READ_LIMIT }, async (req, reply) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    void reply.header('Cache-Control', 'public, max-age=30');
    return uc.getEventTimeline.execute({ eventId });
  });

  app.post('/v1/events', { preHandler: authenticate }, async (req, reply) => {
    const body = S.CreateEventBody.parse(req.body);
    const out = await uc.createEvent.execute({ organizerId: userId(req), ...body });
    return reply.status(201).send(out);
  });

  app.post('/v1/events/:eventId/cancel', { preHandler: authenticate }, async (req, reply) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    await uc.cancelEvent.execute({ eventId, userId: userId(req) });
    return reply.status(204).send();
  });

  // ---------------- presença ----------------
  app.get('/v1/events/:eventId/me', { preHandler: authenticate }, async (req) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    const uid = userId(req);
    const [attendance, event] = await Promise.all([
      uc.getMyAttendance.execute({ userId: uid, eventId }),
      uc.getEvent.execute({ eventId }),
    ]);
    return { ...attendance, isOrganizer: event.organizerId === uid };
  });

  // por sessão (ver rateLimitKey), nunca por IP
  const presenceRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/v1/events/:eventId/presence/challenge', { preHandler: authenticate, config: presenceRateLimit }, async (req) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    return uc.issuePresenceChallenge.execute({ userId: userId(req), eventId });
  });

  app.post('/v1/events/:eventId/presence', { preHandler: authenticate, config: presenceRateLimit }, async (req) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    const body = S.PresenceSampleBody.parse(req.body);
    return uc.submitPresenceSample.execute({ userId: userId(req), eventId, ...body });
  });

  app.post('/v1/events/:eventId/virtual-support', { preHandler: authenticate }, async (req) => {
    const { eventId } = S.EventIdParams.parse(req.params);
    return uc.declareVirtualSupport.execute({ userId: userId(req), eventId });
  });

  return app;
}
