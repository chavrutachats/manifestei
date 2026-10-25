import type { AttendanceView, InconclusiveReason, PresenceStatus, VirtualReason } from './types';

export const STATUS_LABEL: Record<PresenceStatus | 'NONE', string> = {
  NONE: 'Sem registro',
  PENDING_ON_SITE: 'Em verificação',
  CONFIRMED_ON_SITE: 'Confirmado no local',
  VIRTUAL_SUPPORTER: 'Apoio virtual',
};

/** Texto do carimbo (único lugar com caixa-alta: é a linguagem do carimbo). */
export const STAMP_TEXT: Record<PresenceStatus | 'NONE', string> = {
  NONE: 'SEM REGISTRO',
  PENDING_ON_SITE: 'EM VERIFICAÇÃO',
  CONFIRMED_ON_SITE: 'PRESENTE',
  VIRTUAL_SUPPORTER: 'APOIO VIRTUAL',
};

/**
 * Por que alguém virou apoio virtual. A pessoa tem direito de saber o motivo de
 * uma decisão automatizada sobre ela (LGPD art. 20) — e o rebaixamento por
 * fraude é definitivo naquele ato, então explicar não ajuda quem tenta burlar.
 */
export const VIRTUAL_REASON_TEXT: Record<VirtualReason, string> = {
  DECLARED_BY_USER: 'Você escolheu apoiar à distância.',
  UNTRUSTED_DEVICE:
    'Este aparelho não passou na verificação de integridade (emulador, sistema modificado ou app fora da loja oficial). Ele pode apoiar à distância, mas não confirmar presença.',
  DEVICE_INTEGRITY_FAILED:
    'A verificação do aparelho indicou sistema modificado (root, jailbreak ou emulador).',
  APP_INTEGRITY_FAILED: 'Esta cópia do app não é a versão oficial da loja.',
  ATTESTATION_INVALID: 'A assinatura de segurança do aparelho não conferiu.',
  PAYLOAD_TAMPERED: 'Os dados da leitura foram alterados depois de assinados.',
  MOCK_LOCATION: 'Detectamos localização simulada (app de GPS falso ou ferramenta de desenvolvedor).',
  IMPOSSIBLE_TRAVEL: 'Sua localização mudou mais rápido do que é fisicamente possível.',
  DEVICE_SHARED: 'Este aparelho já confirmou a presença de outra pessoa neste ato.',
};

/** Leituras que não contam, mas não punem: o app explica e tenta de novo. */
export const INCONCLUSIVE_TEXT: Record<InconclusiveReason, string> = {
  LOW_ACCURACY: 'O sinal de GPS está fraco. Vá para um lugar mais aberto, longe de prédios altos.',
  OUTSIDE_AREA: 'Você ainda está fora da área do ato.',
  OUTSIDE_TIME_WINDOW: 'O registro de presença deste ato não está aberto agora.',
  STALE_OR_SKEWED_FIX: 'A leitura do GPS chegou atrasada. Vamos ler de novo.',
  ATTESTATION_PROVIDER_UNAVAILABLE:
    'O serviço que verifica o aparelho está fora do ar. Vamos tentar de novo em instantes.',
};

export const isFraudReason = (r: VirtualReason | null): boolean => r !== null && r !== 'DECLARED_BY_USER';

export type StampTone = 'confirmed' | 'pending' | 'virtual' | 'fraud' | 'none';

export const stampToneFor = (a: Pick<AttendanceView, 'status' | 'virtualReason'>): StampTone =>
  a.status === 'CONFIRMED_ON_SITE'
    ? 'confirmed'
    : a.status === 'PENDING_ON_SITE'
      ? 'pending'
      : a.status === 'VIRTUAL_SUPPORTER'
        ? isFraudReason(a.virtualReason)
          ? 'fraud'
          : 'virtual'
        : 'none';
