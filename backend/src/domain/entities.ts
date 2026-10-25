import type { GeoPoint } from './geo.js';
import type { AttendanceState } from './presence.js';

export type Platform = 'ios' | 'android';

export interface User {
  id: string;
  /**
   * Participante anônimo = um aparelho físico verificado.
   * HMAC-SHA256(pepper, "plataforma:âncora"). Nem a âncora nem dado pessoal algum é persistido.
   */
  anchorHash: string;
  displayName: string | null;
  /** Versão do termo de consentimento aceito (LGPD art. 11, I — dado sensível: opinião política). */
  consentVersion: string;
  consentedAt: Date;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type DeviceTrust = 'TRUSTED' | 'UNTRUSTED';

export interface Device {
  id: string;
  userId: string;
  platform: Platform;
  /** UUID gerado pelo app e guardado no Keychain/Keystore. */
  installationId: string;
  trust: DeviceTrust;
  untrustedReason: string | null;
  /** Somente iOS (App Attest). */
  appAttest: {
    keyId: string;
    publicKeyPem: string;
    signCount: number;
    environment: 'production' | 'development';
  } | null;
  active: boolean;
  createdAt: Date;
}

export type EventAreaInput =
  | { kind: 'circle'; center: GeoPoint; radiusM: number }
  | { kind: 'route'; path: GeoPoint[]; widthM: number };

export type EventStatus = 'SCHEDULED' | 'CANCELLED';

export interface ProtestEvent {
  id: string;
  /** null quando quem organizou excluiu a conta. */
  organizerId: string | null;
  title: string;
  description: string;
  city: string | null;
  startsAt: Date;
  endsAt: Date;
  areaKind: 'circle' | 'route';
  /** GeoJSON da área (Polygon) para o app desenhar. */
  areaGeoJson: unknown;
  /** Área real em m² (PostGIS, geography). Base do teto físico de lotação. */
  areaM2: number;
  status: EventStatus;
  createdAt: Date;
}

export interface AttendanceCounts {
  confirmedOnSite: number;
  pendingOnSite: number;
  /** Inclui quem declarou apoio virtual E quem foi rebaixado por suspeita. */
  virtualSupporters: number;
  /** Subconjunto de virtualSupporters rebaixado automaticamente (transparência pública). */
  downgradedForFraud: number;
}

export interface AttendanceRecord extends AttendanceState {
  id: string;
  eventId: string;
  /** null depois que a conta é excluída (registro anonimizado, contagem preservada). */
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SampleVerdictKind = 'VALID' | 'INCONCLUSIVE' | 'FRAUD';

export interface PresenceSample {
  id: string;
  attendanceId: string;
  deviceId: string;
  installationId: string;
  receivedAt: Date;
  fixTimestamp: Date;
  location: GeoPoint;
  accuracyM: number;
  distanceToAreaM: number;
  verdict: SampleVerdictKind;
  reason: string | null;
}
