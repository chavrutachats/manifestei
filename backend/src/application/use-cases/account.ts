import { DomainError } from '../../domain/errors.js';
import type {
  AccountRepository,
  DeviceRepository,
  ExpiringFlagStore,
  UserRepository,
} from '../ports.js';
import { recreateLockKey } from './auth.js';

export interface MeView {
  userId: string;
  displayName: string | null;
  consentVersion: string;
  createdAt: string;
  device: {
    id: string;
    platform: 'ios' | 'android';
    trust: 'TRUSTED' | 'UNTRUSTED';
    /** Motivo técnico genérico. Não revela qual verificação exata falhou. */
    canConfirmOnSite: boolean;
  } | null;
}

export class GetMe {
  constructor(private readonly d: { users: UserRepository; devices: DeviceRepository }) {}

  async execute(input: { userId: string }): Promise<MeView> {
    const user = await this.d.users.findById(input.userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Conta não encontrada.');
    const device = await this.d.devices.findActiveByUser(user.id);
    return {
      userId: user.id,
      displayName: user.displayName,
      consentVersion: user.consentVersion,
      createdAt: user.createdAt.toISOString(),
      device: device
        ? {
            id: device.id,
            platform: device.platform,
            trust: device.trust,
            canConfirmOnSite: device.trust === 'TRUSTED',
          }
        : null,
    };
  }
}

/**
 * "Apagar meus dados" (LGPD art. 18, VI; App Store 5.1.1(v); Google Play).
 *
 * Depois disso, nada liga o aparelho às presenças, mas a presença continua contada
 * (registro anonimizado). Para impedir contagem dupla — apagar no meio do ato e
 * entrar de novo com o mesmo aparelho — o HMAC da âncora fica bloqueado por um
 * período maior que a duração máxima de um ato (24 h + janela de registro).
 * É um dado pseudônimo, com prazo, e só serve a isso.
 */
export class DeleteAccount {
  constructor(
    private readonly d: {
      users: UserRepository;
      accounts: AccountRepository;
      flags: ExpiringFlagStore;
      recreateLockSeconds: number;
    },
  ) {}

  async execute(input: { userId: string }): Promise<void> {
    const user = await this.d.users.findById(input.userId);
    if (!user) return; // idempotente
    await this.d.flags.set(recreateLockKey(user.anchorHash), this.d.recreateLockSeconds);
    await this.d.accounts.deleteAndAnonymize(user.id);
  }
}
