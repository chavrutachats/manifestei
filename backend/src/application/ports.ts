/**
 * Portas (interfaces) que a camada de aplicação exige do mundo externo.
 * A infraestrutura implementa; os casos de uso só conhecem estes contratos.
 */
import type {
  AttendanceCounts,
  AttendanceRecord,
  Device,
  EventAreaInput,
  PresenceSample,
  ProtestEvent,
  Session,
  User,
} from '../domain/entities.js';
import type { GeoPoint } from '../domain/geo.js';
import type { AttestationCheck } from '../domain/presence.js';

// ---------- utilitários ----------
export interface Clock {
  now(): Date;
}
export interface IdGenerator {
  uuid(): string;
}

// ---------- segurança ----------
/** HMAC da âncora do aparelho. O valor em claro nunca é persistido. */
export interface DeviceAnchorHasher {
  hash(platform: 'ios' | 'android', anchor: string): string;
}

/** Marcadores com expiração (Redis). Guardam só chaves pseudônimas (HMAC), nunca dados em claro. */
export interface ExpiringFlagStore {
  set(key: string, ttlSeconds: number): Promise<void>;
  has(key: string): Promise<boolean>;
}

/** Desafios aleatórios de uso único (anti-replay). */
export interface ChallengeStore {
  issue(scope: string, ttlSeconds: number): Promise<string>;
  /** Atômico: retorna true uma única vez por desafio emitido. */
  consume(scope: string, challenge: string): Promise<boolean>;
}

export interface AccessClaims {
  userId: string;
  sessionId: string;
}
export interface TokenService {
  issueAccessToken(claims: AccessClaims): Promise<{ token: string; expiresInSeconds: number }>;
  verifyAccessToken(token: string): Promise<AccessClaims>;
  newRefreshToken(): { token: string; hash: string };
  hashRefreshToken(token: string): string;
}

export interface IosAttestationResult {
  ok: boolean;
  failure?: string;
  publicKeyPem?: string;
  environment?: 'production' | 'development';
  receipt?: Buffer;
}

export interface IosAttestationVerifier {
  verifyAttestation(input: { keyId: string; attestationB64: string; clientData: string }): Promise<IosAttestationResult>;
  verifyAssertion(input: {
    publicKeyPem: string;
    storedSignCount: number;
    assertionB64: string;
    clientData: string;
  }): Promise<AttestationCheck & { signCount?: number }>;
}

export interface AndroidIntegrityVerifier {
  verify(input: { integrityToken: string; expectedRequestHash: string }): Promise<AttestationCheck>;
}

/** sha256 em base64 — o mesmo cálculo que o app faz antes de pedir a atestação. */
export interface PayloadHasher {
  sha256Base64(data: string): string;
}

// ---------- persistência ----------
export interface UserRepository {
  findByAnchorHash(anchorHash: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  insert(user: User): Promise<void>;
  updateConsent(userId: string, version: string, at: Date): Promise<void>;
}

export interface AccountRepository {
  /**
   * Exclusão definitiva, numa transação: corta o vínculo pessoa↔presença
   * (user_id/device_id/installation_id → NULL), apaga coordenadas, sessões,
   * aparelhos e o usuário. As contagens dos atos permanecem corretas.
   */
  deleteAndAnonymize(userId: string): Promise<void>;
}

export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findByRefreshHash(hash: string): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  rotate(id: string, newHash: string, newExpiresAt: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  /** Na nova matrícula do mesmo aparelho, sessões de instalações antigas deixam de valer. */
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface DeviceRepository {
  findById(id: string): Promise<Device | null>;
  findActiveByUser(userId: string): Promise<Device | null>;
  /** Desativa os demais aparelhos do usuário e grava este como o único ativo. */
  replaceActiveDevice(device: Device, receipt?: Buffer): Promise<void>;
  /** Compare-and-set do contador do App Attest. false = contador não avançou (replay). */
  advanceSignCount(deviceId: string, newCount: number): Promise<boolean>;
  touch(deviceId: string, at: Date): Promise<void>;
}

export interface NewEvent {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  city: string | null;
  startsAt: Date;
  endsAt: Date;
  area: EventAreaInput;
}

export interface EventRepository {
  insert(e: NewEvent): Promise<void>;
  findById(id: string): Promise<ProtestEvent | null>;
  listActiveOrUpcoming(now: Date, limit: number): Promise<ProtestEvent[]>;
  cancel(id: string): Promise<void>;
  counts(eventId: string): Promise<AttendanceCounts>;
  countsMany(eventIds: string[]): Promise<Map<string, AttendanceCounts>>;
  countCreatedBy(organizerId: string, since: Date): Promise<number>;
  /** Chegada e última leitura válida de cada pessoa CONFIRMADA no local. Sem coordenadas, sem identidade. */
  presenceIntervals(eventId: string): Promise<Array<{ arrivedAt: Date; lastSeenAt: Date }>>;
}

export interface Geofence {
  /** Distância (m) do ponto até a área do evento; 0 = dentro. */
  distanceToEventArea(eventId: string, point: GeoPoint): Promise<number>;
}

/** Repositório usado DENTRO de uma transação com lock pessimista. */
export interface AttendanceTxRepository {
  /** Lock transacional por aparelho: impede que dois usuários validem pelo mesmo aparelho em paralelo. */
  lockInstallation(installationId: string): Promise<void>;
  /**
   * INSERT ... ON CONFLICT DO NOTHING + SELECT ... FOR UPDATE.
   * Devolve o registro existente (ou o recém-criado) já travado até o fim da transação,
   * sem corrida entre duas primeiras amostras simultâneas.
   */
  lockOrCreate(initial: AttendanceRecord): Promise<AttendanceRecord>;
  update(record: AttendanceRecord): Promise<void>;
  /** Última amostra com coordenada do usuário em QUALQUER evento (velocidade impossível entre atos). */
  lastSampleForUser(userId: string): Promise<PresenceSample | null>;
  insertSample(sample: PresenceSample): Promise<void>;
  installationValidatedForOtherUser(eventId: string, installationId: string, userId: string): Promise<boolean>;
}

export interface TransactionRunner {
  run<T>(fn: (tx: { attendance: AttendanceTxRepository }) => Promise<T>): Promise<T>;
}

export interface AttendanceReadRepository {
  find(eventId: string, userId: string): Promise<AttendanceRecord | null>;
}
