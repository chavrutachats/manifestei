import type {
  CreateEventInput,
  EnrollmentResult,
  Me,
  MyAttendance,
  PresenceSampleResult,
  ProtestEvent,
  AttendanceView,
  EventTimeline,
} from '../domain/types';
import type { DeviceAttestationBody, PresenceAttestationBody } from '../security/attestation';
import { request } from './http';

export interface Challenge {
  challenge: string;
  expiresInSeconds: number;
}

export const api = {
  // ---- identidade do aparelho (sem cadastro) ----
  enrollChallenge: (installationId: string) =>
    request<Challenge>('POST', '/v1/enroll/challenge', { installationId }, { auth: false }),
  enroll: (body: {
    platform: 'ios' | 'android';
    installationId: string;
    deviceAnchor: string;
    consentVersion: string;
    challenge: string;
    attestation: DeviceAttestationBody;
  }) => request<EnrollmentResult>('POST', '/v1/enroll', body, { auth: false }),

  // ---- conta ----
  me: () => request<Me>('GET', '/v1/me'),
  deleteAccount: () => request<void>('DELETE', '/v1/me'),

  // ---- eventos ----
  listEvents: () => request<{ events: ProtestEvent[] }>('GET', '/v1/events?limit=100', undefined, { auth: false }),
  getEvent: (id: string) => request<ProtestEvent>('GET', `/v1/events/${id}`, undefined, { auth: false }),
  getTimeline: (id: string) => request<EventTimeline>('GET', `/v1/events/${id}/timeline`, undefined, { auth: false }),
  createEvent: (body: CreateEventInput) => request<{ id: string }>('POST', '/v1/events', body),
  cancelEvent: (id: string) => request<void>('POST', `/v1/events/${id}/cancel`),

  // ---- presença ----
  myAttendance: (eventId: string) => request<MyAttendance>('GET', `/v1/events/${eventId}/me`),
  presenceChallenge: (eventId: string) => request<Challenge>('POST', `/v1/events/${eventId}/presence/challenge`),
  submitPresence: (
    eventId: string,
    body: {
      deviceId: string;
      challenge: string;
      location: { latitude: number; longitude: number; accuracyM: number; fixTimestampMs: number; isMock: boolean };
      attestation: PresenceAttestationBody;
    },
  ) => request<PresenceSampleResult>('POST', `/v1/events/${eventId}/presence`, body),
  declareVirtualSupport: (eventId: string) => request<AttendanceView>('POST', `/v1/events/${eventId}/virtual-support`),
};
