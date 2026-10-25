/**
 * Contrato app ↔ servidor: as duas implementações do payload canônico precisam
 * gerar bytes idênticos, senão toda atestação falharia (BINDING_MISMATCH) e
 * pessoas reais seriam rebaixadas. Rode no CI:  npm run verify:contract
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as server from '../../backend/src/domain/signed-payload.ts';
import * as app from '../src/security/signedPayload.ts';

const VECTOR = {
  eventId: '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d',
  challenge: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
  installationId: '11111111-2222-4333-8444-555555555555',
  latitude: -23.5505199,
  longitude: -46.6333094,
  accuracyM: 8.25,
  fixTimestampMs: 1_763_215_200_123,
  isMock: false,
};
const EXPECTED =
  'mf1|presence|6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d|Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5|11111111-2222-4333-8444-555555555555|-23.550520|-46.633309|8.3|1763215200123|0';

assert.equal(app.canonicalPresencePayload(VECTOR), EXPECTED);
assert.equal(server.canonicalPresencePayload(VECTOR), EXPECTED);

// fuzz: 5.000 leituras aleatórias, mesma saída nos dois lados
for (let i = 0; i < 5000; i++) {
  const v = {
    ...VECTOR,
    latitude: (Math.random() - 0.5) * 180,
    longitude: (Math.random() - 0.5) * 360,
    accuracyM: Math.random() * 120,
    fixTimestampMs: Date.now() - Math.random() * 1e6 + Math.random(),
    isMock: Math.random() < 0.5,
  };
  assert.equal(app.canonicalPresencePayload(v), server.canonicalPresencePayload(v));
}

for (const reg of [
  { platform: 'android' as const, challenge: 'abc', installationId: 'x', deviceAnchor: '9774d56d682e549c' },
  { platform: 'ios' as const, challenge: 'abc', installationId: 'x', deviceAnchor: '0F3A1C2B-7D4E-4A5B-9C6D-112233445566' },
]) {
  assert.equal(app.canonicalDeviceRegistration(reg), server.canonicalDeviceRegistration(reg));
  // a âncora precisa caber no formato que o servidor aceita
  assert.match(reg.deviceAnchor, server.DEVICE_ANCHOR_PATTERN);
}

const sha = createHash('sha256').update(EXPECTED, 'utf8').digest('base64');
console.log(`contrato OK — sha256(vetor) = ${sha}`);
