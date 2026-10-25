import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { PresencePolicyConfig } from './domain/presence.js';
import type { CheckInWindowConfig } from './application/use-cases/presence.js';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default('0.0.0.0'),
    TRUST_PROXY: bool.default(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    JWT_SECRET: z.string().min(32),
    /** Pepper do HMAC da âncora do aparelho. Trocar depois do lançamento "esquece" todos os aparelhos. */
    DEVICE_ANCHOR_PEPPER: z.string().min(32),

    APPLE_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/),
    APPLE_BUNDLE_ID: z.string().min(3),
    APPLE_APP_ATTEST_ALLOW_DEVELOPMENT: bool.default(false),
    APPLE_APP_ATTEST_ROOT_CA_PATH: z.string().default('./certs/Apple_App_Attestation_Root_CA.pem'),

    ANDROID_PACKAGE_NAME: z.string().min(3),
    /** JSON da service account (opcional se GOOGLE_APPLICATION_CREDENTIALS estiver definido). */
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
    PLAY_INTEGRITY_REQUIRE_STRONG: bool.default(false),
    PLAY_INTEGRITY_REQUIRE_LICENSED: bool.default(false),
    PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: z.string().default(''),
    PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS: z.coerce.number().int().positive().default(120),
    PLAY_INTEGRITY_REJECT_UNKNOWN_CONTROLLING: bool.default(true),
    PLAY_INTEGRITY_REJECT_HIGH_ACTIVITY: bool.default(true),

    /** Versão vigente do termo de consentimento. O app envia a versão que a pessoa aceitou. */
    CONSENT_VERSION: z.string().min(1).default('2026-10'),
    /** Horas em que um aparelho fica impedido de recriar identidade após apagar os dados (anti-contagem dupla). */
    ACCOUNT_RECREATE_LOCK_HOURS: z.coerce.number().positive().default(26),

    PRESENCE_MAX_ACCURACY_M: z.coerce.number().positive().default(50),
    PRESENCE_AREA_TOLERANCE_M: z.coerce.number().nonnegative().default(25),
    PRESENCE_MAX_FIX_AGE_SECONDS: z.coerce.number().positive().default(120),
    PRESENCE_MAX_SPEED_MPS: z.coerce.number().positive().default(70),
    /** Padrão: 2 leituras com 45 min de intervalo. 1 e 0 = a primeira leitura confirma. */
    PRESENCE_MIN_SAMPLES: z.coerce.number().int().min(1).default(2),
    PRESENCE_MIN_DWELL_MINUTES: z.coerce.number().nonnegative().default(45),
    /** Intervalo das leituras automáticas. Menor = pico mais preciso, mais bateria e mais tokens da Play Integrity. */
    PRESENCE_SAMPLE_INTERVAL_MINUTES: z.coerce.number().min(5).max(60).default(15),
    CHECKIN_OPENS_BEFORE_START_MINUTES: z.coerce.number().nonnegative().default(60),
    CHECKIN_CLOSES_AFTER_END_MINUTES: z.coerce.number().nonnegative().default(30),
    LOCATION_RETENTION_HOURS: z.coerce.number().positive().default(72),
  })
  .superRefine((env, ctx) => {
    if (env.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'App Attest de desenvolvimento é proibido em produção', path: ['APPLE_APP_ATTEST_ALLOW_DEVELOPMENT'] });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env;
  appleRootCaPem: string;
  presencePolicy: PresencePolicyConfig;
  checkInWindow: CheckInWindowConfig;
  playIntegrityCertDigests: string[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const env = parsed.data;
  return {
    env,
    appleRootCaPem: readFileSync(env.APPLE_APP_ATTEST_ROOT_CA_PATH, 'utf8'),
    presencePolicy: {
      maxAccuracyM: env.PRESENCE_MAX_ACCURACY_M,
      areaToleranceM: env.PRESENCE_AREA_TOLERANCE_M,
      maxFixAgeMs: env.PRESENCE_MAX_FIX_AGE_SECONDS * 1000,
      maxFutureSkewMs: 30_000,
      maxPlausibleSpeedMps: env.PRESENCE_MAX_SPEED_MPS,
      minValidSamples: env.PRESENCE_MIN_SAMPLES,
      minDwellMs: env.PRESENCE_MIN_DWELL_MINUTES * 60_000,
      sampleIntervalMs: env.PRESENCE_SAMPLE_INTERVAL_MINUTES * 60_000,
    },
    checkInWindow: {
      opensBeforeStartMs: env.CHECKIN_OPENS_BEFORE_START_MINUTES * 60_000,
      closesAfterEndMs: env.CHECKIN_CLOSES_AFTER_END_MINUTES * 60_000,
    },
    playIntegrityCertDigests: env.PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS.split(',').map((s) => s.trim()).filter(Boolean),
  };
}
