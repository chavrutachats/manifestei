import { requireNativeModule } from 'expo';

export interface NativeLocationFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  fixTimestampMs: number;
  /**
   * Android: Location.isMock() / isFromMockProvider().
   * iOS 15+: CLLocationSourceInformation.isSimulatedBySoftware || isProducedByAccessory.
   */
  isMock: boolean;
}

interface ManifesteiIntegrityNative {
  // ---- iOS (App Attest) ----
  isAppAttestSupported(): Promise<boolean>;
  generateAppAttestKey(): Promise<string>;
  attestAppAttestKey(keyId: string, clientDataHashBase64: string): Promise<string>;
  generateAppAttestAssertion(keyId: string, clientDataHashBase64: string): Promise<string>;

  // ---- Android (Play Integrity, requisições "standard") ----
  preparePlayIntegrity(cloudProjectNumber: string): Promise<boolean>;
  requestPlayIntegrityToken(requestHash: string): Promise<string>;

  // ---- ambos ----
  /** Leitura única de alta precisão. Nunca reaproveita fix em cache. Permissão deve ter sido concedida antes. */
  getCurrentLocation(): Promise<NativeLocationFix>;
}

export default requireNativeModule<ManifesteiIntegrityNative>('ManifesteiIntegrity');
