import { X509Certificate, createHash, createVerify, timingSafeEqual } from 'node:crypto';
import { decode } from 'cbor-x';
import type { IosAttestationResult, IosAttestationVerifier } from '../../application/ports.js';
import type { AttestationCheck } from '../../domain/presence.js';

/**
 * Verificação de App Attest (iOS 14+) seguindo a documentação da Apple:
 * "Validating apps that connect to your server".
 *
 * Atestação (uma vez por aparelho/instalação):
 *  1. cadeia x5c → Apple App Attestation Root CA
 *  2. nonce = SHA256(authData ‖ SHA256(clientData)) deve estar na extensão
 *     1.2.840.113635.100.8.2 do certificado folha
 *  3. SHA256(chave pública da folha) == keyId
 *  4. rpIdHash == SHA256("<TEAM_ID>.<BUNDLE_ID>")
 *  5. contador == 0, aaguid de produção (ou develop, se permitido), credentialId == keyId
 *
 * Asserção (a cada check-in):
 *  1. assinatura ECDSA P-256 sobre SHA256(authenticatorData ‖ SHA256(clientData))
 *  2. rpIdHash == appId
 *  3. contador estritamente maior que o último salvo (anti-replay)
 */

const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest', 'ascii'), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop', 'ascii');

/** DER de: SEQUENCE { [1] EXPLICIT OCTET STRING (32 bytes) } — conteúdo da extensão do nonce. */
const NONCE_EXT_PREFIX = Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]);
/** DER do OID 1.2.840.113635.100.8.2 */
const NONCE_EXT_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

const sha256 = (...parts: Buffer[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const safeEqual = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

export class AppAttestError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export interface AppleAppAttestConfig {
  teamId: string;
  bundleId: string;
  allowDevelopmentEnvironment: boolean;
  rootCaPem: string;
  now?: () => Date;
}

interface ParsedAuthData {
  rpIdHash: Buffer;
  signCount: number;
  aaguid?: Buffer;
  credentialId?: Buffer;
}

function parseAuthData(authData: Buffer, withAttestedCredential: boolean): ParsedAuthData {
  if (authData.length < 37) throw new AppAttestError('AUTHDATA_TOO_SHORT');
  const rpIdHash = authData.subarray(0, 32);
  const signCount = authData.readUInt32BE(33);
  if (!withAttestedCredential) return { rpIdHash, signCount };
  if (authData.length < 55) throw new AppAttestError('AUTHDATA_TOO_SHORT');
  const aaguid = authData.subarray(37, 53);
  const credIdLen = authData.readUInt16BE(53);
  if (authData.length < 55 + credIdLen) throw new AppAttestError('AUTHDATA_TOO_SHORT');
  const credentialId = authData.subarray(55, 55 + credIdLen);
  return { rpIdHash, signCount, aaguid, credentialId };
}

/**
 * Extrai o nonce da extensão Apple. Leitor DER mínimo e estrito: procura o OID,
 * depois um OCTET STRING com exatamente o formato esperado. Qualquer desvio = falha.
 */
export function extractAppleNonce(certDer: Buffer): Buffer {
  const at = certDer.indexOf(NONCE_EXT_OID);
  if (at < 0) throw new AppAttestError('NONCE_EXTENSION_MISSING');
  let i = at + NONCE_EXT_OID.length;
  // critical BOOLEAN opcional
  if (certDer[i] === 0x01) i += 2 + (certDer[i + 1] ?? 0);
  if (certDer[i] !== 0x04 || certDer[i + 1] !== NONCE_EXT_PREFIX.length + 32) {
    throw new AppAttestError('NONCE_EXTENSION_MALFORMED');
  }
  i += 2;
  const content = certDer.subarray(i, i + NONCE_EXT_PREFIX.length + 32);
  if (!content.subarray(0, NONCE_EXT_PREFIX.length).equals(NONCE_EXT_PREFIX)) {
    throw new AppAttestError('NONCE_EXTENSION_MALFORMED');
  }
  return content.subarray(NONCE_EXT_PREFIX.length);
}

function rawPublicKey(cert: X509Certificate): Buffer {
  const jwk = cert.publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new AppAttestError('LEAF_KEY_NOT_P256');
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

function assertValidAt(cert: X509Certificate, now: Date, label: string): void {
  if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
    throw new AppAttestError(`${label}_CERT_EXPIRED_OR_NOT_YET_VALID`);
  }
}

export class AppleAppAttestVerifier implements IosAttestationVerifier {
  private readonly appIdHash: Buffer;
  private readonly root: X509Certificate;
  private readonly now: () => Date;

  constructor(private readonly cfg: AppleAppAttestConfig) {
    this.appIdHash = sha256(Buffer.from(`${cfg.teamId}.${cfg.bundleId}`, 'utf8'));
    this.root = new X509Certificate(cfg.rootCaPem);
    this.now = cfg.now ?? (() => new Date());
  }

  async verifyAttestation(input: {
    keyId: string;
    attestationB64: string;
    clientData: string;
  }): Promise<IosAttestationResult> {
    try {
      return this.verifyAttestationOrThrow(input);
    } catch (err) {
      return { ok: false, failure: err instanceof AppAttestError ? err.reason : 'MALFORMED_ATTESTATION' };
    }
  }

  private verifyAttestationOrThrow(input: {
    keyId: string;
    attestationB64: string;
    clientData: string;
  }): IosAttestationResult {
    const obj = decode(Buffer.from(input.attestationB64, 'base64')) as {
      fmt?: string;
      attStmt?: { x5c?: Uint8Array[]; receipt?: Uint8Array };
      authData?: Uint8Array;
    };
    if (obj.fmt !== 'apple-appattest') throw new AppAttestError('UNEXPECTED_FORMAT');
    const x5c = obj.attStmt?.x5c;
    if (!Array.isArray(x5c) || x5c.length < 2 || !obj.authData) throw new AppAttestError('MISSING_FIELDS');

    // 1. cadeia de certificados
    const now = this.now();
    const leaf = new X509Certificate(Buffer.from(x5c[0] as Uint8Array));
    const intermediate = new X509Certificate(Buffer.from(x5c[1] as Uint8Array));
    assertValidAt(leaf, now, 'LEAF');
    assertValidAt(intermediate, now, 'INTERMEDIATE');
    assertValidAt(this.root, now, 'ROOT');
    if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) {
      throw new AppAttestError('LEAF_NOT_SIGNED_BY_INTERMEDIATE');
    }
    if (!intermediate.ca) throw new AppAttestError('INTERMEDIATE_NOT_CA');
    if (!intermediate.checkIssued(this.root) || !intermediate.verify(this.root.publicKey)) {
      throw new AppAttestError('INTERMEDIATE_NOT_SIGNED_BY_ROOT');
    }

    // 2. nonce
    const authData = Buffer.from(obj.authData);
    const clientDataHash = sha256(Buffer.from(input.clientData, 'utf8'));
    const expectedNonce = sha256(authData, clientDataHash);
    if (!safeEqual(extractAppleNonce(leaf.raw), expectedNonce)) throw new AppAttestError('NONCE_MISMATCH');

    // 3. keyId
    const keyId = Buffer.from(input.keyId, 'base64');
    const publicKeyRaw = rawPublicKey(leaf);
    if (!safeEqual(sha256(publicKeyRaw), keyId)) throw new AppAttestError('KEY_ID_MISMATCH');

    // 4 e 5. authData
    const parsed = parseAuthData(authData, true);
    if (!safeEqual(parsed.rpIdHash, this.appIdHash)) throw new AppAttestError('APP_ID_MISMATCH');
    if (parsed.signCount !== 0) throw new AppAttestError('COUNTER_NOT_ZERO');

    let environment: 'production' | 'development';
    if (parsed.aaguid && safeEqual(parsed.aaguid, AAGUID_PRODUCTION)) environment = 'production';
    else if (parsed.aaguid && safeEqual(parsed.aaguid, AAGUID_DEVELOPMENT) && this.cfg.allowDevelopmentEnvironment) {
      environment = 'development';
    } else throw new AppAttestError('AAGUID_NOT_ALLOWED');

    if (!parsed.credentialId || !safeEqual(parsed.credentialId, keyId)) throw new AppAttestError('CREDENTIAL_ID_MISMATCH');

    return {
      ok: true,
      publicKeyPem: leaf.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      environment,
      receipt: obj.attStmt?.receipt ? Buffer.from(obj.attStmt.receipt) : undefined,
    };
  }

  async verifyAssertion(input: {
    publicKeyPem: string;
    storedSignCount: number;
    assertionB64: string;
    clientData: string;
  }): Promise<AttestationCheck & { signCount?: number }> {
    try {
      const obj = decode(Buffer.from(input.assertionB64, 'base64')) as {
        signature?: Uint8Array;
        authenticatorData?: Uint8Array;
      };
      if (!obj.signature || !obj.authenticatorData) return { ok: false, failure: 'INVALID', detail: 'MISSING_FIELDS' };

      const authenticatorData = Buffer.from(obj.authenticatorData);
      const clientDataHash = sha256(Buffer.from(input.clientData, 'utf8'));
      const nonce = sha256(authenticatorData, clientDataHash);

      // O dispositivo assina o nonce com ECDSA-SHA256 (o nonce é hasheado novamente pelo algoritmo).
      const signatureOk = createVerify('SHA256').update(nonce).verify(input.publicKeyPem, Buffer.from(obj.signature));
      if (!signatureOk) {
        // Assinatura que não confere = payload alterado depois de atestado OU chave errada.
        return { ok: false, failure: 'BINDING_MISMATCH', detail: 'SIGNATURE_INVALID' };
      }

      const parsed = parseAuthData(authenticatorData, false);
      if (!safeEqual(parsed.rpIdHash, this.appIdHash)) return { ok: false, failure: 'APP_INTEGRITY', detail: 'APP_ID_MISMATCH' };
      if (parsed.signCount <= input.storedSignCount) return { ok: false, failure: 'INVALID', detail: 'COUNTER_REPLAY' };

      return { ok: true, signCount: parsed.signCount };
    } catch {
      return { ok: false, failure: 'INVALID', detail: 'MALFORMED_ASSERTION' };
    }
  }
}
