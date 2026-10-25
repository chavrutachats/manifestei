import { z } from 'zod';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const geoPoint = z.object({ latitude, longitude });
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const base64 = z.string().regex(/^[A-Za-z0-9+/=_-]+$/).max(20_000);

export const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export const EnrollChallengeBody = z.object({ installationId: z.uuid() });

export const EnrollBody = z.object({
  platform: z.enum(['ios', 'android']),
  installationId: z.uuid(),
  deviceAnchor: z.string().min(8).max(64),
  consentVersion: z.string().min(1).max(40),
  challenge: z.string().min(20).max(100),
  attestation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ios'), keyId: base64, attestation: base64 }),
    z.object({ kind: z.literal('android'), integrityToken: z.string().min(10).max(20_000) }),
    z.object({ kind: z.literal('unsupported'), detail: z.string().max(200).optional() }),
  ]),
});

export const EventIdParams = z.object({ eventId: z.uuid() });

export const CreateEventBody = z.object({
  title: z.string().min(5).max(120),
  description: z.string().max(4000).default(''),
  city: z.string().max(80).nullable().default(null),
  startsAt: isoDate,
  endsAt: isoDate,
  area: z.discriminatedUnion('kind', [
    // limites finos (raio, largura, comprimento) ficam no domínio: domain/event-area.ts
    z.object({ kind: z.literal('circle'), center: geoPoint, radiusM: z.number().positive().max(100_000) }),
    z.object({
      kind: z.literal('route'),
      path: z.array(geoPoint).min(2).max(500),
      widthM: z.number().positive().max(100_000),
    }),
  ]),
});

export const ListEventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

export const PresenceSampleBody = z.object({
  deviceId: z.uuid(),
  challenge: z.string().min(20).max(100),
  location: z.object({
    latitude,
    longitude,
    accuracyM: z.number().positive().max(100_000),
    fixTimestampMs: z.number().int().positive(),
    isMock: z.boolean(),
  }),
  attestation: z.discriminatedUnion('platform', [
    z.object({ platform: z.literal('ios'), assertion: base64 }),
    z.object({ platform: z.literal('android'), integrityToken: z.string().min(10).max(20_000) }),
    z.object({ platform: z.literal('unsupported') }),
  ]),
});
