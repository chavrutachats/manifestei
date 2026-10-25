import { createHash, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, decode } from 'cbor-x';
import { describe, expect, it } from 'vitest';
import { AppleAppAttestVerifier, extractAppleNonce } from '../../src/infrastructure/attestation/apple-app-attest.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'app-attest');
const fx = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')) as {
  teamId: string;
  bundleId: string;
  clientData: string;
  keyId: string;
  attestation: string;
};
const rootCaPem = readFileSync(join(dir, 'root.pem'), 'utf8');
const leafPrivatePem = readFileSync(join(dir, 'leaf-private.pem'), 'utf8');

const make = (over: Partial<ConstructorParameters<typeof AppleAppAttestVerifier>[0]> = {}) =>
  new AppleAppAttestVerifier({
    teamId: fx.teamId,
    bundleId: fx.bundleId,
    allowDevelopmentEnvironment: true,
    rootCaPem,
    now: () => new Date(),
    ...over,
  });

const sha256 = (...b: Buffer[]) => b.reduce((h, x) => h.update(x), createHash('sha256')).digest();

/** Simula o que o Secure Enclave faz em generateAssertion. */
function makeAssertion(clientData: string, counter: number, teamId = fx.teamId, bundleId = fx.bundleId): string {
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([sha256(Buffer.from(`${teamId}.${bundleId}`)), Buffer.from([0x40]), c]);
  const nonce = sha256(authenticatorData, sha256(Buffer.from(clientData)));
  const signature = createSign('SHA256').update(nonce).sign(leafPrivatePem);
  return Buffer.from(encode({ signature, authenticatorData })).toString('base64');
}

describe('App Attest — atestação', () => {
  it('aceita cadeia, nonce, keyId e appId corretos', async () => {
    const res = await make().verifyAttestation({ keyId: fx.keyId, attestationB64: fx.attestation, clientData: fx.clientData });
    expect(res.ok).toBe(true);
    expect(res.environment).toBe('development');
    expect(res.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('rejeita clientData diferente do atestado (nonce)', async () => {
    const res = await make().verifyAttestation({ keyId: fx.keyId, attestationB64: fx.attestation, clientData: fx.clientData + 'x' });
    expect(res).toMatchObject({ ok: false, failure: 'NONCE_MISMATCH' });
  });

  it('rejeita outro app (bundle diferente)', async () => {
    const res = await make({ bundleId: 'com.atacante.clone' }).verifyAttestation({
      keyId: fx.keyId,
      attestationB64: fx.attestation,
      clientData: fx.clientData,
    });
    expect(res).toMatchObject({ ok: false, failure: 'APP_ID_MISMATCH' });
  });

  it('rejeita keyId que não corresponde à chave do certificado', async () => {
    const res = await make().verifyAttestation({
      keyId: Buffer.alloc(32, 7).toString('base64'),
      attestationB64: fx.attestation,
      clientData: fx.clientData,
    });
    expect(res).toMatchObject({ ok: false, failure: 'KEY_ID_MISMATCH' });
  });

  it('rejeita ambiente de desenvolvimento quando não permitido (produção)', async () => {
    const res = await make({ allowDevelopmentEnvironment: false }).verifyAttestation({
      keyId: fx.keyId,
      attestationB64: fx.attestation,
      clientData: fx.clientData,
    });
    expect(res).toMatchObject({ ok: false, failure: 'AAGUID_NOT_ALLOWED' });
  });

  it('rejeita cadeia que não termina na raiz confiável', async () => {
    const otherRoot = readFileSync(join(dir, 'leaf-private.pem'), 'utf8'); // não é certificado: força raiz inválida
    expect(() => make({ rootCaPem: otherRoot })).toThrow();
    // raiz válida porém diferente: usa o próprio intermediário embutido como "raiz"
    const att = decode(Buffer.from(fx.attestation, 'base64')) as { attStmt: { x5c: Uint8Array[] } };
    const intermediatePem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(att.attStmt.x5c[1]!).toString('base64')}\n-----END CERTIFICATE-----`;
    const res = await make({ rootCaPem: intermediatePem }).verifyAttestation({
      keyId: fx.keyId,
      attestationB64: fx.attestation,
      clientData: fx.clientData,
    });
    expect(res).toMatchObject({ ok: false, failure: 'INTERMEDIATE_NOT_SIGNED_BY_ROOT' });
  });

  it('rejeita certificado fora da validade', async () => {
    const res = await make({ now: () => new Date('2090-01-01T00:00:00Z') }).verifyAttestation({
      keyId: fx.keyId,
      attestationB64: fx.attestation,
      clientData: fx.clientData,
    });
    expect(res.ok).toBe(false);
  });

  it('extrai o nonce da extensão Apple', () => {
    const att = decode(Buffer.from(fx.attestation, 'base64')) as { attStmt: { x5c: Uint8Array[] } };
    expect(extractAppleNonce(Buffer.from(att.attStmt.x5c[0]!))).toHaveLength(32);
  });
});

describe('App Attest — asserção', () => {
  const setup = async () => {
    const reg = await make().verifyAttestation({ keyId: fx.keyId, attestationB64: fx.attestation, clientData: fx.clientData });
    return reg.publicKeyPem!;
  };

  it('aceita asserção assinada pela chave atestada com contador maior', async () => {
    const publicKeyPem = await setup();
    const res = await make().verifyAssertion({
      publicKeyPem,
      storedSignCount: 4,
      assertionB64: makeAssertion('payload-a', 5),
      clientData: 'payload-a',
    });
    expect(res).toEqual({ ok: true, signCount: 5 });
  });

  it('payload alterado depois de assinado → BINDING_MISMATCH', async () => {
    const publicKeyPem = await setup();
    const res = await make().verifyAssertion({
      publicKeyPem,
      storedSignCount: 0,
      assertionB64: makeAssertion('lat=-23.55', 1),
      clientData: 'lat=-22.90',
    });
    expect(res).toMatchObject({ ok: false, failure: 'BINDING_MISMATCH' });
  });

  it('contador que não avança → replay', async () => {
    const publicKeyPem = await setup();
    const res = await make().verifyAssertion({
      publicKeyPem,
      storedSignCount: 9,
      assertionB64: makeAssertion('x', 9),
      clientData: 'x',
    });
    expect(res).toMatchObject({ ok: false, failure: 'INVALID', detail: 'COUNTER_REPLAY' });
  });

  it('asserção de outro app → APP_INTEGRITY', async () => {
    const publicKeyPem = await setup();
    const res = await make().verifyAssertion({
      publicKeyPem,
      storedSignCount: 0,
      assertionB64: makeAssertion('x', 1, fx.teamId, 'com.outro.app'),
      clientData: 'x',
    });
    expect(res).toMatchObject({ ok: false, failure: 'APP_INTEGRITY' });
  });

  it('lixo na entrada não derruba o servidor', async () => {
    const res = await make().verifyAssertion({ publicKeyPem: 'x', storedSignCount: 0, assertionB64: 'AAAA', clientData: 'x' });
    expect(res.ok).toBe(false);
  });
});
