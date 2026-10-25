import { loadConfig } from './config.js';
import { buildUseCases } from './container.js';
import { AppleAppAttestVerifier } from './infrastructure/attestation/apple-app-attest.js';
import {
  GooglePlayIntegrityDecoder,
  PlayIntegrityVerifier,
} from './infrastructure/attestation/play-integrity.js';
import { createPool } from './infrastructure/db/pool.js';
import { RedisChallengeStore, RedisFlagStore, createRedis } from './infrastructure/redis.js';
import {
  CryptoIdGenerator,
  HmacAnchorHasher,
  JoseTokenService,
  Sha256PayloadHasher,
  SystemClock,
} from './infrastructure/security.js';
import { buildServer } from './interfaces/http/server.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { env } = cfg;

  const pool = createPool(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const clock = new SystemClock();
  const tokens = new JoseTokenService(env.JWT_SECRET);

  const useCases = buildUseCases({
    pool,
    clock,
    ids: new CryptoIdGenerator(),
    tokens,
    anchorHasher: new HmacAnchorHasher(env.DEVICE_ANCHOR_PEPPER),
    payloadHasher: new Sha256PayloadHasher(),
    flags: new RedisFlagStore(redis),
    challenges: new RedisChallengeStore(redis),
    ios: new AppleAppAttestVerifier({
      teamId: env.APPLE_TEAM_ID,
      bundleId: env.APPLE_BUNDLE_ID,
      allowDevelopmentEnvironment: env.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT,
      rootCaPem: cfg.appleRootCaPem,
    }),
    android: new PlayIntegrityVerifier(
      new GooglePlayIntegrityDecoder(env.ANDROID_PACKAGE_NAME, env.GOOGLE_SERVICE_ACCOUNT_JSON),
      {
        packageName: env.ANDROID_PACKAGE_NAME,
        allowedCertificateDigests: cfg.playIntegrityCertDigests,
        requireStrongIntegrity: env.PLAY_INTEGRITY_REQUIRE_STRONG,
        requireLicensed: env.PLAY_INTEGRITY_REQUIRE_LICENSED,
        maxTokenAgeMs: env.PLAY_INTEGRITY_MAX_TOKEN_AGE_SECONDS * 1000,
        rejectUnknownControllingApps: env.PLAY_INTEGRITY_REJECT_UNKNOWN_CONTROLLING,
        rejectHighDeviceActivity: env.PLAY_INTEGRITY_REJECT_HIGH_ACTIVITY,
      },
    ),
    policy: cfg.presencePolicy,
    window: cfg.checkInWindow,
    currentConsentVersion: env.CONSENT_VERSION,
    recreateLockSeconds: env.ACCOUNT_RECREATE_LOCK_HOURS * 3600,
  });

  const app = await buildServer({
    useCases,
    tokens,
    redis,
    trustProxy: env.TRUST_PROXY,
    logLevel: env.LOG_LEVEL,
    readiness: async () => {
      await pool.query('SELECT 1');
      await redis.ping();
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando');
    await app.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
