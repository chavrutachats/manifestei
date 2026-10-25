/** Contratos da API. Espelham backend/src/interfaces/http. */

export type PresenceStatus = 'PENDING_ON_SITE' | 'CONFIRMED_ON_SITE' | 'VIRTUAL_SUPPORTER';
export type EventPhase = 'UPCOMING' | 'LIVE' | 'ENDED' | 'CANCELLED';

export type VirtualReason =
  | 'DECLARED_BY_USER'
  | 'UNTRUSTED_DEVICE'
  | 'DEVICE_INTEGRITY_FAILED'
  | 'APP_INTEGRITY_FAILED'
  | 'ATTESTATION_INVALID'
  | 'PAYLOAD_TAMPERED'
  | 'MOCK_LOCATION'
  | 'IMPOSSIBLE_TRAVEL'
  | 'DEVICE_SHARED';

export type InconclusiveReason =
  | 'LOW_ACCURACY'
  | 'OUTSIDE_AREA'
  | 'OUTSIDE_TIME_WINDOW'
  | 'STALE_OR_SKEWED_FIX'
  | 'ATTESTATION_PROVIDER_UNAVAILABLE';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Counts {
  confirmedOnSite: number;
  pendingOnSite: number;
  virtualSupporters: number;
  downgradedForFraud: number;
}

export interface AreaIntegrity {
  areaM2: number;
  maxPlausibleOnSite: number;
  capacityAnomaly: boolean;
}

export type AreaGeoJson =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface ProtestEvent {
  id: string;
  title: string;
  description: string;
  city: string | null;
  startsAt: string;
  endsAt: string;
  areaKind: 'circle' | 'route';
  area: AreaGeoJson;
  phase: EventPhase;
  counts: Counts;
  integrity: AreaIntegrity;
}

export interface AttendanceView {
  eventId: string;
  status: PresenceStatus | 'NONE';
  virtualReason: VirtualReason | null;
  validSampleCount: number;
  requiredSamples: number;
  confirmableAfter: string | null;
  /** Regras vigentes no servidor (a API manda; o app não fixa valores). */
  minDwellMinutes: number;
  sampleIntervalSeconds: number;
}

export interface MyAttendance extends AttendanceView {
  isOrganizer: boolean;
}

export type SampleVerdict = 'VALID' | 'INCONCLUSIVE' | 'FRAUD';

export interface PresenceSampleResult extends AttendanceView {
  sample: {
    verdict: SampleVerdict;
    reason: VirtualReason | InconclusiveReason | null;
    /** Só quando fora da área: metros até a borda (arredondado a 10 m). */
    distanceToAreaM: number | null;
  };
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  userId: string;
}

export interface EnrollmentResult extends AuthTokens {
  deviceId: string;
}

export interface Me {
  userId: string;
  displayName: string | null;
  consentVersion: string;
  createdAt: string;
  device: {
    id: string;
    platform: 'ios' | 'android';
    trust: 'TRUSTED' | 'UNTRUSTED';
    canConfirmOnSite: boolean;
  } | null;
}

/** Pico, queda e permanência (GET /v1/events/:id/timeline). Agregado: nada individual. */
export interface EventTimeline {
  eventId: string;
  people: number;
  suppressed: boolean;
  minPeople: number;
  bucketMinutes: number;
  sampleIntervalMinutes: number;
  series: Array<{ at: string; onSite: number }>;
  peak: { at: string; onSite: number } | null;
  declineStartedAt: string | null;
  averageStayMinutes: number | null;
  medianStayMinutes: number | null;
}

export type EventAreaInput =
  | { kind: 'circle'; center: GeoPoint; radiusM: number }
  | { kind: 'route'; path: GeoPoint[]; widthM: number };

export interface CreateEventInput {
  title: string;
  description: string;
  city: string | null;
  startsAt: string;
  endsAt: string;
  area: EventAreaInput;
}

/** Limites do domínio (backend/src/domain/event-area.ts). */
export const AREA_LIMITS = {
  circleMinRadiusM: 50,
  circleMaxRadiusM: 1500,
  routeMinWidthM: 20,
  routeMaxWidthM: 300,
  routeMaxLengthM: 25_000,
} as const;
