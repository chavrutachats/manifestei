import Constants from 'expo-constants';

interface Extra {
  apiUrl?: string;
  playIntegrityCloudProjectNumber?: string;
  consentVersion?: string;
  supportEmail?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const config = {
  apiUrl: (extra.apiUrl ?? 'http://localhost:3000').replace(/\/$/, ''),
  playIntegrityCloudProjectNumber: extra.playIntegrityCloudProjectNumber ?? '',
  consentVersion: extra.consentVersion ?? '2026-10',
  supportEmail: extra.supportEmail ?? 'revisao@manifestei.org.br',
} as const;
