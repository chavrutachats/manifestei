import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDeviceRegistration, canonicalPresencePayload } from '../../src/domain/signed-payload.js';

/**
 * VETOR FIXO compartilhado com mobile/src/security/signedPayload.test.ts.
 * Se este teste mudar, o do app precisa mudar junto (e vice-versa).
 */
export const VECTOR = {
  input: {
    eventId: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
    challenge: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
    installationId: '11111111-2222-4333-8444-555555555555',
    latitude: -23.5505199,
    longitude: -46.6333094,
    accuracyM: 8.25,
    fixTimestampMs: 1_763_215_200_123,
    isMock: false,
  },
  canonical:
    'mf1|presence|6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d|Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5|11111111-2222-4333-8444-555555555555|-23.550520|-46.633309|8.3|1763215200123|0',
};

describe('payload canônico', () => {
  it('produz exatamente a string do vetor fixo', () => {
    expect(canonicalPresencePayload(VECTOR.input)).toBe(VECTOR.canonical);
  });

  it('qualquer alteração de coordenada muda o hash', () => {
    const a = createHash('sha256').update(canonicalPresencePayload(VECTOR.input)).digest('base64');
    const b = createHash('sha256')
      .update(canonicalPresencePayload({ ...VECTOR.input, latitude: VECTOR.input.latitude + 0.00001 }))
      .digest('base64');
    expect(a).not.toBe(b);
  });

  it('matrícula do aparelho inclui a âncora (assinada junto)', () => {
    expect(
      canonicalDeviceRegistration({ platform: 'android', challenge: 'abc', installationId: 'x', deviceAnchor: '9774d56d682e549c' }),
    ).toBe('mf1|device-registration|android|abc|x|9774d56d682e549c');
  });
});
