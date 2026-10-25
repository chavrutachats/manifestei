import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuração nativa do Manifestei (iOS + Android).
 *
 * Variáveis de ambiente (EAS Secrets em produção):
 *   MANIFESTEI_API_URL                 URL HTTPS da API
 *   PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER número (não o id!) do projeto Google Cloud vinculado no Play Console
 *   GOOGLE_MAPS_ANDROID_API_KEY         chave do Maps SDK for Android
 *   APP_ATTEST_ENV                      "production" (padrão) | "development"
 *   EAS_PROJECT_ID                      id do projeto no EAS
 */
const IS_PROD = process.env.APP_VARIANT !== 'development';

const LOCATION_PURPOSE =
  'Depois que você toca em "Estou no ato", o Manifestei confere sua localização a cada 15 minutos, inclusive com o app em segundo plano, até você sair da área ou o ato terminar. É assim que sua presença é confirmada e o pico do ato é medido. Fora de um ato, nada é coletado.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_PROD ? 'Manifestei' : 'Manifestei (dev)',
  slug: 'manifestei',
  scheme: 'manifestei',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F6F6F3',

  ios: {
    bundleIdentifier: IS_PROD ? 'br.org.manifestei.app' : 'br.org.manifestei.app.dev',
    buildNumber: '1',
    supportsTablet: false,
    // App Attest: "production" em TestFlight/App Store; "development" só em builds de desenvolvimento.
    entitlements: {
      'com.apple.developer.devicecheck.appattest-environment': process.env.APP_ATTEST_ENV ?? 'production',
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_PURPOSE,
      // Somente HTTPS/TLS padrão do sistema: isento de declaração de criptografia.
      ITSAppUsesNonExemptEncryption: false,
    },
    // Manifesto de privacidade exigido pela Apple desde 2024.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          // código anônimo do aparelho (HMAC no servidor) para garantir um registro por ato
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
          NSPrivacyCollectedDataTypeLinked: false,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },

  android: {
    package: IS_PROD ? 'br.org.manifestei.app' : 'br.org.manifestei.app.dev',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#3343B5',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
    ],
    // Sem "localização em segundo plano" de verdade: o registro roda num serviço em
    // primeiro plano, com notificação, iniciado por um toque da pessoa.
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_PHONE_STATE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    predictiveBackGestureEnabled: false,
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-location',
      {
        locationWhenInUsePermission: LOCATION_PURPOSE,
        motionUsagePermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        // iOS: modo de fundo "location" (indicador azul visível). Não pede "Sempre".
        isIosBackgroundLocationEnabled: true,
        // Android: serviço em primeiro plano com notificação, iniciado pelo toque.
        // NÃO usa ACCESS_BACKGROUND_LOCATION (continua bloqueada abaixo).
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'react-native-maps',
      // iOS usa Apple Maps (sem chave). Android usa Google Maps.
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' },
    ],
    './plugins/withLocationOnlyBackgroundMode',
    [
      'expo-build-properties',
      {
        // Mínimo do Expo SDK 58. Cobre App Attest (14+) e CLLocationSourceInformation (15+).
        ios: { deploymentTarget: '16.4' },
        // Location.isMock() é API 31; abaixo usamos isFromMockProvider(). Play Integrity exige API 21+.
        android: { minSdkVersion: 26 },
      },
    ],
  ],

  experiments: { typedRoutes: true },

  extra: {
    apiUrl: process.env.MANIFESTEI_API_URL ?? 'http://localhost:3000',
    playIntegrityCloudProjectNumber: process.env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER ?? '',
    /** Precisa ser igual a CONSENT_VERSION da API. Mudou o termo? Suba as duas juntas. */
    consentVersion: '2026-10',
    supportEmail: 'revisao@manifestei.org.br',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
