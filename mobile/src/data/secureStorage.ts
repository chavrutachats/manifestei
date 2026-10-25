import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tudo que é segredo ou identificador fica no Keychain (iOS) / Keystore (Android).
 *
 * THIS_DEVICE_ONLY: o item não vai para o backup do iCloud nem é restaurado em
 * outro iPhone. Sem isso, restaurar um backup num segundo aparelho clonaria o
 * installationId e o vínculo do aparelho.
 */
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const KEYS = {
  refreshToken: 'mf.refreshToken',
  deviceId: 'mf.deviceId',
  appAttestKeyId: 'mf.appAttestKeyId',
  installationId: 'mf.installationId',
  deviceAnchor: 'mf.deviceAnchor',
  presenceSession: 'mf.presenceSession',
  acceptedConsent: 'mf.acceptedConsent',
} as const;

const get = (k: string) => SecureStore.getItemAsync(k, OPTS);
const set = (k: string, v: string) => SecureStore.setItemAsync(k, v, OPTS);
const del = (k: string) => SecureStore.deleteItemAsync(k, OPTS);

export const secureStorage = {
  getRefreshToken: () => get(KEYS.refreshToken),
  setRefreshToken: (v: string) => set(KEYS.refreshToken, v),

  getDeviceId: () => get(KEYS.deviceId),
  setDeviceId: (v: string) => set(KEYS.deviceId, v),

  getAppAttestKeyId: () => get(KEYS.appAttestKeyId),
  setAppAttestKeyId: (v: string) => set(KEYS.appAttestKeyId, v),

  getAcceptedConsent: () => get(KEYS.acceptedConsent),
  setAcceptedConsent: (v: string) => set(KEYS.acceptedConsent, v),
  clearAcceptedConsent: () => del(KEYS.acceptedConsent),

  /**
   * Âncora do APARELHO — o que faz "uma pessoa, um registro por ato" funcionar sem cadastro.
   * Sai do aparelho só dentro de um payload atestado e o servidor guarda apenas um HMAC.
   *
   * Android: ANDROID_ID. Desde o Android 8 é único por (app, usuário do aparelho) e
   *          sobrevive à reinstalação; só muda com restauração de fábrica.
   * iOS:     UUID no Keychain (THIS_DEVICE_ONLY). Itens do Keychain sobrevivem à
   *          reinstalação e não vão para backup/outro iPhone.
   */
  async getDeviceAnchor(): Promise<string> {
    if (Platform.OS === 'android') return Application.getAndroidId();
    const existing = await get(KEYS.deviceAnchor);
    if (existing) return existing;
    const id = Crypto.randomUUID();
    await set(KEYS.deviceAnchor, id);
    return id;
  },

  getPresenceSession: () => get(KEYS.presenceSession),
  setPresenceSession: (v: string) => set(KEYS.presenceSession, v),
  clearPresenceSession: () => del(KEYS.presenceSession),

  /** UUID desta instalação (escopo dos desafios de matrícula e vínculo das leituras). */
  async getInstallationId(): Promise<string> {
    const existing = await get(KEYS.installationId);
    if (existing) return existing;
    const id = Crypto.randomUUID();
    await set(KEYS.installationId, id);
    return id;
  },

  /** Sessão e vínculo do aparelho. A âncora fica (é ela que mantém a identidade única). */
  async clearSession(): Promise<void> {
    await Promise.all([del(KEYS.refreshToken), del(KEYS.deviceId), del(KEYS.appAttestKeyId)]);
  },

  async clearDeviceBinding(): Promise<void> {
    await Promise.all([del(KEYS.deviceId), del(KEYS.appAttestKeyId)]);
  },
};
