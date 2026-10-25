import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import Integrity from '../../modules/manifestei-integrity';
import { config } from '../config';
import { secureStorage } from '../data/secureStorage';

/** Corpos aceitos pela API (backend/src/interfaces/http/schemas.ts). */
export type DeviceAttestationBody =
  | { kind: 'ios'; keyId: string; attestation: string }
  | { kind: 'android'; integrityToken: string }
  | { kind: 'unsupported'; detail?: string };

export type PresenceAttestationBody =
  | { platform: 'ios'; assertion: string }
  | { platform: 'android'; integrityToken: string }
  | { platform: 'unsupported' };

/** Falha passageira (sem rede, serviço da Apple/Google fora). NUNCA vira "unsupported". */
export class AttestationUnavailableError extends Error {
  constructor(detail: string) {
    super(`Verificação do aparelho indisponível: ${detail}`);
    this.name = 'AttestationUnavailableError';
  }
}

/** A chave do Secure Enclave sumiu (restore de backup, reinstalação). O aparelho precisa ser registrado de novo. */
export class DeviceKeyLostError extends Error {
  constructor() {
    super('Chave de segurança do aparelho perdida');
    this.name = 'DeviceKeyLostError';
  }
}

/** SHA-256 em base64 — o mesmo `sha256Base64` do servidor. */
export const sha256Base64 = (data: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data, { encoding: Crypto.CryptoEncoding.BASE64 });

const nativeCode = (err: unknown): string => (err as { code?: string }).code ?? '';

export interface DeviceAttestor {
  /** Registro (uma vez por instalação/conta). */
  attestRegistration(clientData: string): Promise<DeviceAttestationBody>;
  /** Cada leitura de presença: prova que ESTE payload saiu do app oficial neste aparelho. */
  attestPresence(clientData: string): Promise<PresenceAttestationBody>;
}

// ----------------------------------------------------------------------------- iOS

class IosAppAttestor implements DeviceAttestor {
  async attestRegistration(clientData: string): Promise<DeviceAttestationBody> {
    // Simulador e aparelhos sem Secure Enclave: o servidor grava como não confiável.
    if (!(await Integrity.isAppAttestSupported())) return { kind: 'unsupported', detail: 'APP_ATTEST_UNSUPPORTED' };
    try {
      const keyId = await Integrity.generateAppAttestKey();
      const attestation = await Integrity.attestAppAttestKey(keyId, await sha256Base64(clientData));
      return { kind: 'ios', keyId, attestation };
    } catch (err) {
      if (nativeCode(err) === 'E_APP_ATTEST_UNSUPPORTED') return { kind: 'unsupported', detail: 'APP_ATTEST_UNSUPPORTED' };
      throw new AttestationUnavailableError(nativeCode(err) || 'APP_ATTEST');
    }
  }

  async attestPresence(clientData: string): Promise<PresenceAttestationBody> {
    const keyId = await secureStorage.getAppAttestKeyId();
    if (!keyId) {
      if (!(await Integrity.isAppAttestSupported())) return { platform: 'unsupported' };
      throw new DeviceKeyLostError();
    }
    try {
      const assertion = await Integrity.generateAppAttestAssertion(keyId, await sha256Base64(clientData));
      return { platform: 'ios', assertion };
    } catch (err) {
      if (nativeCode(err) === 'E_APP_ATTEST_INVALID_KEY') throw new DeviceKeyLostError();
      throw new AttestationUnavailableError(nativeCode(err) || 'APP_ATTEST');
    }
  }
}

// ------------------------------------------------------------------------- Android

class AndroidPlayIntegrityAttestor implements DeviceAttestor {
  private prepared: Promise<void> | null = null;

  /** O "prepare" aquece o provider (pode levar segundos); depois cada token sai em ~100 ms. */
  private prepare(): Promise<void> {
    this.prepared ??= Integrity.preparePlayIntegrity(config.playIntegrityCloudProjectNumber)
      .then(() => undefined)
      .catch((err: unknown) => {
        this.prepared = null;
        throw err;
      });
    return this.prepared;
  }

  private async token(clientData: string): Promise<string> {
    const requestHash = await sha256Base64(clientData);
    try {
      await this.prepare();
      return await Integrity.requestPlayIntegrityToken(requestHash);
    } catch {
      // provider expirado/inválido: prepara de novo uma vez
      this.prepared = null;
      await this.prepare();
      return Integrity.requestPlayIntegrityToken(requestHash);
    }
  }

  async attestRegistration(clientData: string): Promise<DeviceAttestationBody> {
    try {
      return { kind: 'android', integrityToken: await this.token(clientData) };
    } catch (err) {
      // Sem Google Play / Play Services (emuladores puros, aparelhos sem GMS): não confiável.
      if (nativeCode(err) === 'E_INTEGRITY_UNAVAILABLE_ON_DEVICE') {
        return { kind: 'unsupported', detail: 'PLAY_INTEGRITY_UNAVAILABLE_ON_DEVICE' };
      }
      throw new AttestationUnavailableError(nativeCode(err) || 'PLAY_INTEGRITY');
    }
  }

  async attestPresence(clientData: string): Promise<PresenceAttestationBody> {
    try {
      return { platform: 'android', integrityToken: await this.token(clientData) };
    } catch (err) {
      throw new AttestationUnavailableError(nativeCode(err) || 'PLAY_INTEGRITY');
    }
  }
}

export const deviceAttestor: DeviceAttestor =
  Platform.OS === 'ios' ? new IosAppAttestor() : new AndroidPlayIntegrityAttestor();
