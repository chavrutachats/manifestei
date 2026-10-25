import type { AttendanceRecord, Device, ProtestEvent } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import { haversineMeters, isValidGeoPoint } from '../../domain/geo.js';
import {
  applyVerdict,
  declareVirtual,
  evaluateSample,
  initialAttendanceState,
  nextConfirmationWindow,
  type AttendanceState,
  type AttestationCheck,
  type InconclusiveReason,
  type PresencePolicyConfig,
  type PresenceStatus,
  type SampleSignals,
  type VirtualReason,
} from '../../domain/presence.js';
import { canonicalPresencePayload } from '../../domain/signed-payload.js';
import type {
  AndroidIntegrityVerifier,
  AttendanceReadRepository,
  ChallengeStore,
  Clock,
  DeviceRepository,
  EventRepository,
  Geofence,
  IdGenerator,
  IosAttestationVerifier,
  PayloadHasher,
  TransactionRunner,
} from '../ports.js';
import { CHALLENGE_TTL_SECONDS, presenceChallengeScope } from '../scopes.js';

export interface CheckInWindowConfig {
  opensBeforeStartMs: number;
  closesAfterEndMs: number;
}

export const DEFAULT_CHECKIN_WINDOW: CheckInWindowConfig = {
  opensBeforeStartMs: 60 * 60_000,
  closesAfterEndMs: 30 * 60_000,
};

function isWithinCheckInWindow(e: ProtestEvent, now: Date, w: CheckInWindowConfig): boolean {
  return (
    now.getTime() >= e.startsAt.getTime() - w.opensBeforeStartMs &&
    now.getTime() <= e.endsAt.getTime() + w.closesAfterEndMs
  );
}

export interface AttendanceView {
  eventId: string;
  status: PresenceStatus | 'NONE';
  virtualReason: VirtualReason | null;
  validSampleCount: number;
  requiredSamples: number;
  /** Momento a partir do qual a próxima amostra válida pode confirmar a presença. */
  confirmableAfter: string | null;
  /** Regras vigentes, para o app agendar as leituras automáticas sem valores fixos no código. */
  minDwellMinutes: number;
  sampleIntervalSeconds: number;
}

function toView(eventId: string, st: AttendanceState | null, cfg: PresencePolicyConfig): AttendanceView {
  // Registro criado por uma leitura que não valeu (fora da área, GPS fraco): para a
  // pessoa e para a contagem, ela ainda não registrou nada.
  const rules = { minDwellMinutes: Math.round(cfg.minDwellMs / 60_000), sampleIntervalSeconds: Math.round(cfg.sampleIntervalMs / 1000) };
  if (!st || (st.status === 'PENDING_ON_SITE' && st.validSampleCount === 0)) {
    return { eventId, status: 'NONE', virtualReason: null, validSampleCount: 0, requiredSamples: cfg.minValidSamples, confirmableAfter: null, ...rules };
  }
  return {
    eventId,
    status: st.status,
    virtualReason: st.virtualReason,
    validSampleCount: st.validSampleCount,
    requiredSamples: cfg.minValidSamples,
    confirmableAfter: nextConfirmationWindow(st, cfg)?.toISOString() ?? null,
    ...rules,
  };
}

// ---------------------------------------------------------------------------

export class IssuePresenceChallenge {
  constructor(
    private readonly d: { events: EventRepository; challenges: ChallengeStore; clock: Clock; window: CheckInWindowConfig },
  ) {}

  async execute(input: { userId: string; eventId: string }): Promise<{ challenge: string; expiresInSeconds: number }> {
    const e = await this.d.events.findById(input.eventId);
    if (!e) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');
    if (e.status === 'CANCELLED') throw new DomainError('EVENT_CLOSED', 'Evento cancelado.');
    if (!isWithinCheckInWindow(e, this.d.clock.now(), this.d.window)) {
      throw new DomainError('EVENT_CLOSED', 'O check-in deste evento não está aberto agora.');
    }
    const challenge = await this.d.challenges.issue(
      presenceChallengeScope(input.userId, input.eventId),
      CHALLENGE_TTL_SECONDS,
    );
    return { challenge, expiresInSeconds: CHALLENGE_TTL_SECONDS };
  }
}

// ---------------------------------------------------------------------------

export type PresenceAttestationInput =
  | { platform: 'ios'; assertion: string }
  | { platform: 'android'; integrityToken: string }
  | { platform: 'unsupported' };

export interface SubmitPresenceSampleInput {
  userId: string;
  eventId: string;
  deviceId: string;
  challenge: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyM: number;
    fixTimestampMs: number;
    isMock: boolean;
  };
  attestation: PresenceAttestationInput;
}

export interface SubmitPresenceSampleOutput extends AttendanceView {
  sample: {
    verdict: 'VALID' | 'INCONCLUSIVE' | 'FRAUD';
    reason: VirtualReason | InconclusiveReason | null;
    /** Só quando a pessoa está fora da área: quantos metros faltam (arredondado a 10 m). */
    distanceToAreaM: number | null;
  };
}

/**
 * Caso de uso central. Fluxo:
 *  1. desafio de uso único (anti-replay)
 *  2. aparelho registrado e ativo do próprio usuário
 *  3. atestação de hardware/app vinculada ao payload canônico
 *  4. sinais de localização (mock, precisão, idade do fix, geocerca no PostGIS)
 *  5. dentro de transação com lock: velocidade desde a última amostra,
 *     aparelho compartilhado, máquina de estados, persistência
 */
export class SubmitPresenceSample {
  constructor(
    private readonly d: {
      events: EventRepository;
      devices: DeviceRepository;
      challenges: ChallengeStore;
      ios: IosAttestationVerifier;
      android: AndroidIntegrityVerifier;
      payloadHasher: PayloadHasher;
      geofence: Geofence;
      tx: TransactionRunner;
      ids: IdGenerator;
      clock: Clock;
      policy: PresencePolicyConfig;
      window: CheckInWindowConfig;
    },
  ) {}

  async execute(input: SubmitPresenceSampleInput): Promise<SubmitPresenceSampleOutput> {
    const point = { latitude: input.location.latitude, longitude: input.location.longitude };
    if (!isValidGeoPoint(point)) throw new DomainError('VALIDATION', 'Coordenadas inválidas.');

    const event = await this.d.events.findById(input.eventId);
    if (!event) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');
    if (event.status === 'CANCELLED') throw new DomainError('EVENT_CLOSED', 'Evento cancelado.');

    // 1. anti-replay: o desafio é consumido antes de qualquer outra coisa
    const consumed = await this.d.challenges.consume(
      presenceChallengeScope(input.userId, input.eventId),
      input.challenge,
    );
    if (!consumed) throw new DomainError('CHALLENGE_INVALID', 'Desafio expirado ou já utilizado.');

    // 2. aparelho
    const device = await this.d.devices.findById(input.deviceId);
    if (!device || device.userId !== input.userId || !device.active) {
      throw new DomainError('DEVICE_NOT_REGISTERED', 'Aparelho não registrado para este usuário.');
    }

    // 3. atestação vinculada ao payload. O installationId vem do SERVIDOR (registro), não do request.
    const clientData = canonicalPresencePayload({
      eventId: input.eventId,
      challenge: input.challenge,
      installationId: device.installationId,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyM: input.location.accuracyM,
      fixTimestampMs: input.location.fixTimestampMs,
      isMock: input.location.isMock,
    });
    const attestation = await this.verifyAttestation(device, input.attestation, clientData);

    // 4. sinais de localização que não dependem de lock
    const now = this.d.clock.now();
    const distanceToAreaM = await this.d.geofence.distanceToEventArea(event.id, point);
    await this.d.devices.touch(device.id, now);

    // 5. transação: serializa amostras concorrentes do mesmo usuário no mesmo evento
    return this.d.tx.run(async ({ attendance }) => {
      await attendance.lockInstallation(device.installationId);
      const record = await attendance.lockOrCreate(newRecord(this.d.ids.uuid(), event.id, input.userId, now));

      const previous = await attendance.lastSampleForUser(input.userId);
      let impliedSpeedMps: number | null = null;
      if (previous) {
        // Vale entre atos diferentes: check-in em SP e, 2 min depois, no Rio = teletransporte.
        const rawDistance = haversineMeters(previous.location, point);
        // desconta a incerteza das duas leituras: só pega "teletransporte" de verdade
        const effective = Math.max(0, rawDistance - previous.accuracyM - input.location.accuracyM);
        const seconds = Math.max(1, (now.getTime() - previous.receivedAt.getTime()) / 1000);
        impliedSpeedMps = effective / seconds;
      }

      const signals: SampleSignals = {
        attestation,
        isMockLocation: input.location.isMock,
        accuracyM: input.location.accuracyM,
        distanceToAreaM,
        withinEventWindow: isWithinCheckInWindow(event, now, this.d.window),
        fixAgeMs: now.getTime() - input.location.fixTimestampMs,
        impliedSpeedMps,
        deviceUsedByAnotherUser: await attendance.installationValidatedForOtherUser(
          event.id,
          device.installationId,
          input.userId,
        ),
      };

      const verdict = evaluateSample(signals, this.d.policy);
      const nextState = applyVerdict(record, verdict, now, this.d.policy);
      const updated: AttendanceRecord = { ...record, ...nextState, updatedAt: now };

      await attendance.insertSample({
        id: this.d.ids.uuid(),
        attendanceId: record.id,
        deviceId: device.id,
        installationId: device.installationId,
        receivedAt: now,
        fixTimestamp: new Date(input.location.fixTimestampMs),
        location: point,
        accuracyM: input.location.accuracyM,
        distanceToAreaM,
        verdict: verdict.kind,
        reason: verdict.kind === 'VALID' ? null : verdict.reason,
      });
      await attendance.update(updated);

      return {
        ...toView(event.id, updated, this.d.policy),
        sample: {
          verdict: verdict.kind,
          reason: verdict.kind === 'VALID' ? null : verdict.reason,
          distanceToAreaM:
            verdict.kind === 'INCONCLUSIVE' && verdict.reason === 'OUTSIDE_AREA'
              ? Math.round(distanceToAreaM / 10) * 10
              : null,
        },
      };
    });
  }

  private async verifyAttestation(
    device: Device,
    att: PresenceAttestationInput,
    clientData: string,
  ): Promise<AttestationCheck> {
    if (device.trust !== 'TRUSTED' || att.platform === 'unsupported') {
      return { ok: false, failure: 'UNSUPPORTED' };
    }
    if (att.platform !== device.platform) {
      return { ok: false, failure: 'INVALID', detail: 'platform mismatch' };
    }
    if (att.platform === 'android') {
      return this.d.android.verify({
        integrityToken: att.integrityToken,
        expectedRequestHash: this.d.payloadHasher.sha256Base64(clientData),
      });
    }
    return this.verifyIos(device, att.assertion, clientData);
  }

  private async verifyIos(device: Device, assertion: string, clientData: string): Promise<AttestationCheck> {
    if (!device.appAttest) return { ok: false, failure: 'UNSUPPORTED' };
    const res = await this.d.ios.verifyAssertion({
      publicKeyPem: device.appAttest.publicKeyPem,
      storedSignCount: device.appAttest.signCount,
      assertionB64: assertion,
      clientData,
    });
    if (!res.ok) return res;
    // compare-and-set atômico: duas requisições com o mesmo contador → só uma passa
    const advanced = await this.d.devices.advanceSignCount(device.id, res.signCount ?? 0);
    return advanced ? { ok: true } : { ok: false, failure: 'INVALID', detail: 'sign counter replay' };
  }
}

// ---------------------------------------------------------------------------

export class DeclareVirtualSupport {
  constructor(
    private readonly d: {
      events: EventRepository;
      tx: TransactionRunner;
      ids: IdGenerator;
      clock: Clock;
      policy: PresencePolicyConfig;
    },
  ) {}

  async execute(input: { userId: string; eventId: string }): Promise<AttendanceView> {
    const event = await this.d.events.findById(input.eventId);
    if (!event) throw new DomainError('NOT_FOUND', 'Evento não encontrado.');
    if (event.status === 'CANCELLED') throw new DomainError('EVENT_CLOSED', 'Evento cancelado.');
    const now = this.d.clock.now();

    return this.d.tx.run(async ({ attendance }) => {
      const record = await attendance.lockOrCreate(newRecord(this.d.ids.uuid(), event.id, input.userId, now));
      const updated: AttendanceRecord = { ...record, ...declareVirtual(record, now), updatedAt: now };
      await attendance.update(updated);
      return toView(event.id, updated, this.d.policy);
    });
  }
}

export class GetMyAttendance {
  constructor(private readonly d: { attendance: AttendanceReadRepository; policy: PresencePolicyConfig }) {}
  async execute(input: { userId: string; eventId: string }): Promise<AttendanceView> {
    const rec = await this.d.attendance.find(input.eventId, input.userId);
    return toView(input.eventId, rec, this.d.policy);
  }
}

function newRecord(id: string, eventId: string, userId: string, now: Date): AttendanceRecord {
  return { id, eventId, userId, ...initialAttendanceState(), createdAt: now, updatedAt: now };
}
