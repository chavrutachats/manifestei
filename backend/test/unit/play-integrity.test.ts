import { describe, expect, it } from 'vitest';
import {
  normalizeCertDigest,
  PlayIntegrityDecodeError,
  PlayIntegrityVerifier,
  evaluatePlayIntegrityPayload,
  type PlayIntegrityPayload,
  type PlayIntegrityPolicy,
} from '../../src/infrastructure/attestation/play-integrity.js';

const now = new Date('2026-11-15T14:00:00Z');
const policy: PlayIntegrityPolicy = {
  packageName: 'br.org.manifestei.app',
  allowedCertificateDigests: ['CERT_OK'],
  requireStrongIntegrity: false,
  requireLicensed: false,
  maxTokenAgeMs: 120_000,
  rejectUnknownControllingApps: true,
  rejectHighDeviceActivity: true,
};

const payload = (over: Partial<PlayIntegrityPayload> = {}): PlayIntegrityPayload => ({
  requestDetails: { requestPackageName: policy.packageName, requestHash: 'HASH', timestampMillis: String(now.getTime() - 3000) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: policy.packageName, certificateSha256Digest: ['CERT_OK'] },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY', 'MEETS_DEVICE_INTEGRITY'] },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
  ...over,
});

describe('Play Integrity — formato do certificado', () => {
  const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const b64url = Buffer.from(hex, 'hex').toString('base64url');
  const consoleFormat = hex.toUpperCase().match(/../g)!.join(':');

  it('hex do Play Console (com dois-pontos) e base64url do token são o mesmo certificado', () => {
    expect(normalizeCertDigest(consoleFormat)).toBe(hex);
    expect(normalizeCertDigest(b64url)).toBe(hex);
  });

  it('aceita o certificado configurado no formato do Play Console', () => {
    const p: PlayIntegrityPayload = {
      requestDetails: { requestPackageName: 'br.org.manifestei.app', requestHash: 'H', timestampMillis: String(Date.now()) },
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'br.org.manifestei.app', certificateSha256Digest: [b64url] },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    };
    const pol: PlayIntegrityPolicy = {
      packageName: 'br.org.manifestei.app', allowedCertificateDigests: [consoleFormat], requireStrongIntegrity: false,
      requireLicensed: false, maxTokenAgeMs: 120_000, rejectUnknownControllingApps: true, rejectHighDeviceActivity: true,
    };
    expect(evaluatePlayIntegrityPayload(p, 'H', pol, new Date())).toEqual({ ok: true });
  });
});

describe('Play Integrity — avaliação do veredito', () => {
  it('aparelho físico íntegro com app da Play Store passa', () => {
    expect(evaluatePlayIntegrityPayload(payload(), 'HASH', policy, now)).toEqual({ ok: true });
  });

  it('emulador (sem MEETS_DEVICE_INTEGRITY) falha', () => {
    const p = payload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_VIRTUAL_INTEGRITY'] } });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, failure: 'DEVICE_INTEGRITY' });
  });

  it('fazenda de bots (LEVEL_4 de atividade) falha', () => {
    const p = payload({
      deviceIntegrity: {
        deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
        recentDeviceActivity: { deviceActivityLevel: 'LEVEL_4' },
      },
    });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({
      ok: false,
      failure: 'DEVICE_INTEGRITY',
      detail: 'DEVICE_ACTIVITY_LEVEL_4',
    });
  });

  it('app desconhecido controlando a tela (automação/acesso remoto) falha', () => {
    const p = payload({ environmentDetails: { appAccessRiskVerdict: { appsDetected: ['KNOWN_INSTALLED', 'UNKNOWN_CONTROLLING'] } } });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, detail: 'UNKNOWN_CONTROLLING_APP' });
  });

  it('apps conhecidos instalados (teclado, acessibilidade da Play) não são punidos', () => {
    const p = payload({ environmentDetails: { appAccessRiskVerdict: { appsDetected: ['KNOWN_INSTALLED', 'KNOWN_CONTROLLING'] } } });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toEqual({ ok: true });
  });

  it('root/bootloader aberto (só BASIC) falha', () => {
    const p = payload({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, failure: 'DEVICE_INTEGRITY' });
  });

  it('APK modificado / sideload falha', () => {
    const p = payload({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: policy.packageName } });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, failure: 'APP_INTEGRITY' });
  });

  it('assinado com outro certificado falha', () => {
    const p = payload({
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: policy.packageName, certificateSha256Digest: ['OUTRO'] },
    });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, detail: 'SIGNING_CERT_MISMATCH' });
  });

  it('token gerado para outro payload (hash diferente) falha como adulteração', () => {
    expect(evaluatePlayIntegrityPayload(payload(), 'OUTRO_HASH', policy, now)).toMatchObject({
      ok: false,
      failure: 'BINDING_MISMATCH',
    });
  });

  it('token velho é rejeitado', () => {
    const p = payload({
      requestDetails: { requestPackageName: policy.packageName, requestHash: 'HASH', timestampMillis: String(now.getTime() - 600_000) },
    });
    expect(evaluatePlayIntegrityPayload(p, 'HASH', policy, now)).toMatchObject({ ok: false, detail: 'TOKEN_STALE' });
  });

  it('modo estrito exige MEETS_STRONG_INTEGRITY', () => {
    expect(evaluatePlayIntegrityPayload(payload(), 'HASH', { ...policy, requireStrongIntegrity: true }, now)).toMatchObject({
      ok: false,
      failure: 'DEVICE_INTEGRITY',
    });
  });
});

describe('Play Integrity — erros do provedor', () => {
  it('Google fora do ar vira PROVIDER_UNAVAILABLE (não pune o usuário)', async () => {
    const v = new PlayIntegrityVerifier(
      { decode: async () => { throw new PlayIntegrityDecodeError('UNAVAILABLE', 'timeout'); } },
      policy,
      () => now,
    );
    expect(await v.verify({ integrityToken: 'abcdefghijkl', expectedRequestHash: 'HASH' })).toEqual({
      ok: false,
      failure: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('token rejeitado pelo Google vira INVALID', async () => {
    const v = new PlayIntegrityVerifier(
      { decode: async () => { throw new PlayIntegrityDecodeError('INVALID_TOKEN', 'bad'); } },
      policy,
      () => now,
    );
    expect(await v.verify({ integrityToken: 'abcdefghijkl', expectedRequestHash: 'HASH' })).toMatchObject({
      ok: false,
      failure: 'INVALID',
    });
  });
});
