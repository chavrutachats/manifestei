import type pg from 'pg';
import type {
  AndroidIntegrityVerifier,
  ChallengeStore,
  Clock,
  DeviceAnchorHasher,
  ExpiringFlagStore,
  IdGenerator,
  IosAttestationVerifier,
  PayloadHasher,
  TokenService,
} from './application/ports.js';
import { DeleteAccount, GetMe } from './application/use-cases/account.js';
import { EnrollDevice, IssueEnrollmentChallenge, RefreshSession } from './application/use-cases/auth.js';
import { CancelEvent, CreateEvent, GetEvent, ListEvents } from './application/use-cases/events.js';
import {
  DeclareVirtualSupport,
  GetMyAttendance,
  IssuePresenceChallenge,
  SubmitPresenceSample,
  type CheckInWindowConfig,
} from './application/use-cases/presence.js';
import { GetEventTimeline } from './application/use-cases/timeline.js';
import type { PresencePolicyConfig } from './domain/presence.js';
import { PgAttendanceReadRepository, PgTransactionRunner } from './infrastructure/db/attendance-repository.js';
import { PgDeviceRepository } from './infrastructure/db/device-repository.js';
import { PgEventRepository } from './infrastructure/db/event-repository.js';
import {
  PgAccountRepository,
  PgSessionRepository,
  PgUserRepository,
} from './infrastructure/db/user-session-repositories.js';
import type { UseCases } from './interfaces/http/server.js';

export interface ContainerDeps {
  pool: pg.Pool;
  clock: Clock;
  ids: IdGenerator;
  tokens: TokenService;
  anchorHasher: DeviceAnchorHasher;
  payloadHasher: PayloadHasher;
  flags: ExpiringFlagStore;
  challenges: ChallengeStore;
  ios: IosAttestationVerifier;
  android: AndroidIntegrityVerifier;
  policy: PresencePolicyConfig;
  window: CheckInWindowConfig;
  currentConsentVersion: string;
  recreateLockSeconds: number;
}

/** Composition root: o único lugar que conhece implementações concretas. */
export function buildUseCases(d: ContainerDeps): UseCases {
  const users = new PgUserRepository(d.pool);
  const sessions = new PgSessionRepository(d.pool);
  const devices = new PgDeviceRepository(d.pool);
  const events = new PgEventRepository(d.pool);
  const tx = new PgTransactionRunner(d.pool);
  const attendanceRead = new PgAttendanceReadRepository(d.pool);
  const accounts = new PgAccountRepository(d.pool);

  return {
    issueEnrollmentChallenge: new IssueEnrollmentChallenge({ challenges: d.challenges }),
    enrollDevice: new EnrollDevice({
      challenges: d.challenges,
      users,
      devices,
      sessions,
      tokens: d.tokens,
      ios: d.ios,
      android: d.android,
      payloadHasher: d.payloadHasher,
      anchorHasher: d.anchorHasher,
      flags: d.flags,
      ids: d.ids,
      clock: d.clock,
      currentConsentVersion: d.currentConsentVersion,
    }),
    refreshSession: new RefreshSession({ sessions, tokens: d.tokens, clock: d.clock }),
    createEvent: new CreateEvent({ events, ids: d.ids, clock: d.clock }),
    listEvents: new ListEvents({ events, clock: d.clock }),
    getEvent: new GetEvent({ events, clock: d.clock }),
    cancelEvent: new CancelEvent({ events, clock: d.clock }),
    issuePresenceChallenge: new IssuePresenceChallenge({
      events,
      challenges: d.challenges,
      clock: d.clock,
      window: d.window,
    }),
    submitPresenceSample: new SubmitPresenceSample({
      events,
      devices,
      challenges: d.challenges,
      ios: d.ios,
      android: d.android,
      payloadHasher: d.payloadHasher,
      geofence: events,
      tx,
      ids: d.ids,
      clock: d.clock,
      policy: d.policy,
      window: d.window,
    }),
    declareVirtualSupport: new DeclareVirtualSupport({ events, tx, ids: d.ids, clock: d.clock, policy: d.policy }),
    getMyAttendance: new GetMyAttendance({ attendance: attendanceRead, policy: d.policy }),
    getMe: new GetMe({ users, devices }),
    getEventTimeline: new GetEventTimeline({ events, clock: d.clock, policy: d.policy, window: d.window }),
    deleteAccount: new DeleteAccount({
      users,
      accounts,
      flags: d.flags,
      recreateLockSeconds: d.recreateLockSeconds,
    }),
  };
}
