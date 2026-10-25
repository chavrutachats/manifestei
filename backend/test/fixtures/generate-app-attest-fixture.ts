/**
 * Gera uma atestação App Attest SINTÉTICA (cadeia CA própria, mesma estrutura
 * binária da Apple) para testar o verificador sem um iPhone.
 *
 *   npx tsx test/fixtures/generate-app-attest-fixture.ts
 *
 * Requer o binário `openssl`. A saída fica versionada em test/fixtures/app-attest/.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'cbor-x';

export const TEAM_ID = 'ABCDE12345';
export const BUNDLE_ID = 'br.org.manifestei.app';
export const CLIENT_DATA = 'mf1|device-registration|ios|test-challenge|00000000-0000-4000-8000-000000000001';

const out = join(dirname(fileURLToPath(import.meta.url)), 'app-attest');
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'appattest-'));
const p = (f: string) => join(tmp, f);
const ssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' });
const sha256 = (...b: Buffer[]) => b.reduce((h, x) => h.update(x), createHash('sha256')).digest();

// 1. raiz (P-384, como a Apple) e intermediária
ssl('ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', p('root.key'));
ssl('req', '-x509', '-new', '-key', p('root.key'), '-subj', '/CN=Test App Attestation Root CA/O=Test',
  '-days', '7300', '-sha384', '-addext', 'basicConstraints=critical,CA:true', '-out', p('root.pem'));

ssl('ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', p('int.key'));
ssl('req', '-new', '-key', p('int.key'), '-subj', '/CN=Test App Attestation CA 1/O=Test', '-out', p('int.csr'));
writeFileSync(p('int.ext'), 'basicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
ssl('x509', '-req', '-in', p('int.csr'), '-CA', p('root.pem'), '-CAkey', p('root.key'), '-CAcreateserial',
  '-days', '7300', '-sha384', '-extfile', p('int.ext'), '-out', p('int.pem'));

// 2. chave do "Secure Enclave" (P-256) → keyId = SHA256(ponto público não comprimido)
ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p('leaf.key'));
ssl('pkcs8', '-topk8', '-nocrypt', '-in', p('leaf.key'), '-out', p('leaf.pk8'));
const jwk = createPublicKey(readFileSync(p('leaf.key'))).export({ format: 'jwk' });
const rawPub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
const keyId = sha256(rawPub);

// 3. authData: rpIdHash ‖ flags ‖ counter(0) ‖ aaguid ‖ len ‖ credentialId ‖ COSE key
const rpIdHash = sha256(Buffer.from(`${TEAM_ID}.${BUNDLE_ID}`));
const cose = encode(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
const counter = Buffer.alloc(4);
const credLen = Buffer.alloc(2);
credLen.writeUInt16BE(keyId.length);
const authData = Buffer.concat([rpIdHash, Buffer.from([0x40]), counter, Buffer.from('appattestdevelop'), credLen, keyId, cose]);

// 4. nonce na extensão 1.2.840.113635.100.8.2 do certificado folha
const nonce = sha256(authData, sha256(Buffer.from(CLIENT_DATA)));
ssl('req', '-new', '-key', p('leaf.key'), '-subj', '/CN=test-leaf/O=Test', '-out', p('leaf.csr'));
writeFileSync(p('leaf.ext'), `basicConstraints=critical,CA:false\n1.2.840.113635.100.8.2=DER:3024a1220420${nonce.toString('hex')}\n`);
ssl('x509', '-req', '-in', p('leaf.csr'), '-CA', p('int.pem'), '-CAkey', p('int.key'), '-CAcreateserial',
  '-days', '7300', '-sha256', '-extfile', p('leaf.ext'), '-out', p('leaf.pem'));

const der = (pem: string) => Buffer.from(ssl('x509', '-in', pem, '-outform', 'DER'));
const attestation = encode({
  fmt: 'apple-appattest',
  attStmt: { x5c: [der(p('leaf.pem')), der(p('int.pem'))], receipt: Buffer.from('fake-receipt') },
  authData,
});

writeFileSync(join(out, 'root.pem'), readFileSync(p('root.pem')));
writeFileSync(join(out, 'leaf-private.pem'), readFileSync(p('leaf.pk8')));
writeFileSync(
  join(out, 'fixture.json'),
  JSON.stringify(
    { teamId: TEAM_ID, bundleId: BUNDLE_ID, clientData: CLIENT_DATA, keyId: keyId.toString('base64'), attestation: Buffer.from(attestation).toString('base64') },
    null,
    2,
  ),
);
console.log(`Fixture gerada em ${out}`);
