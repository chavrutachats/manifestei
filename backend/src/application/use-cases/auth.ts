import type { Device, Platform } from '../../domain/entities.js';
import { DomainError } from '../../domain/errors.js';
import { DEVICE_ANCHOR_PATTERN, canonicalDeviceRegistration } from '../../domain/signed-payload.js';
import type {
  AndroidIntegrityVerifier,
  ChallengeStore,
  Clock,
  DeviceAnchorHasher,
  DeviceRepository,
  ExpiringFlagStore,
  IdGenerator,
  IosAttestationVerifier,
  PayloadHasher,
  SessionRepository,
  TokenService,
  UserRepository,
} from '../ports.js';
import { CHALLENGE_TTL_SECONDS, enrollChallengeScope } from '../scopes.js';

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Chave do bloqueio de recriação de identidade (só o HMAC da âncora, com TTL). */
export const recreateLockKey = (anchorHash: string): string => `recreate-lock:${anchorHash}`;

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  userId: string;
}

export interface EnrollmentResult extends AuthTokens {
  deviceId: string;
}

// ---------------------------------------------------------------------------

export class IssueEnrollmentChallenge {
  constructor(private readonly d: { challenges: ChallengeStore }) {}

  async execute(input: { installationId: string }): Promise<{ challenge: string; expiresInSeconds: number }> {
    const challenge = await this.d.challenges.issue(enrollChallengeScope(input.installationId), CHALLENGE_TTL_SECONDS);
    return { challenge, expiresInSeconds: CHALLENGE_TTL_SECONDS };
  }
}

// ---------------------------------------------------------------------------

export type EnrollmentAttestation =
  | { kind: 'ios'; keyId: string; attestation: string }
  | { kind: 'android'; integrityToken: string }
  /** Simulador iOS, emulador sem Google Play etc. */
  | { kind: 'unsupported'; detail?: string };

export interface EnrollDeviceInput {
  platform: Platform;
  installationId: string;
  /** ANDROID_ID (Android) ou UUID persistente do Keychain (iOS). */
  deviceAnchor: string;
  challenge: string;
  consentVersion: string;
  attestation: EnrollmentAttestation;
}

/**
 * "Cadastro" sem cadastro. Não há nome, telefone, e-mail nem data de nascimento.
 *
 * O participante É o aparelho: a âncora do aparelho chega dentro de um payload
 * atestado pela Apple/Google (só o app oficial, num aparelho íntegro, consegue
 * produzi-lo) e vira um HMAC. Reinstalar o app devolve a MESMA identidade — é isso
 * que impede registrar presença ou apoio duas vezes no mesmo ato.
 *
 * Aparelho reprovado na atestação não ganha identidade: sem prova de que é um
 * aparelho real, não há como garantir "uma vez só" (um emulador fabrica quantas
 * âncoras quiser), então ele não entra em nenhuma das contagens.
 */
export class EnrollDevice {
  constructor(
    private readonly d: {
      challenges: ChallengeStore;
      users: UserRepository;
      devices: DeviceRepository;
      sessions: SessionRepository;
      tokens: TokenService;
      ios: IosAttestationVerifier;
      android: AndroidIntegrityVerifier;
      payloadHasher: PayloadHasher;
      anchorHasher: DeviceAnchorHasher;
      flags: ExpiringFlagStore;
      ids: IdGenerator;
      clock: Clock;
      currentConsentVersion: string;
    },
  ) {}

  async execute(input: EnrollDeviceInput): Promise<EnrollmentResult> {
    if (input.consentVersion !== this.d.currentConsentVersion) {
      throw new DomainError('CONSENT_REQUIRED', 'É preciso aceitar a versão atual do termo de privacidade.');
    }
    if (!DEVICE_ANCHOR_PATTERN.test(input.deviceAnchor)) {
      throw new DomainError('VALIDATION', 'Identificador do aparelho inválido.');
    }
    if (!(await this.d.challenges.consume(enrollChallengeScope(input.installationId), input.challenge))) {
      throw new DomainError('CHALLENGE_INVALID', 'Desafio expirado ou já utilizado.');
    }

    const clientData = canonicalDeviceRegistration({
      platform: input.platform,
      challenge: input.challenge,
      installationId: input.installationId,
      deviceAnchor: input.deviceAnchor,
    });
    const verified = await this.verify(input, clientData);

    const now = this.d.clock.now();
    const anchorHash = this.d.anchorHasher.hash(input.platform, input.deviceAnchor);
    let user = await this.d.users.findByAnchorHash(anchorHash);
    if (!user) {
      // Quem apagou os dados há pouco não recria a identidade de imediato: o registro
      // anônimo continua contando no ato em andamento e uma identidade nova contaria
      // a mesma pessoa duas vezes (ou "limparia" um rebaixamento por fraude).
      if (await this.d.flags.has(recreateLockKey(anchorHash))) {
        throw new DomainError(
          'RATE_LIMITED',
          'Os dados deste aparelho foram apagados há pouco. Aguarde 24 horas para usar o app de novo.',
        );
      }
      await this.d.users.insert({
        id: this.d.ids.uuid(),
        anchorHash,
        displayName: null,
        consentVersion: input.consentVersion,
        consentedAt: now,
        createdAt: now,
      });
      user = await this.d.users.findByAnchorHash(anchorHash); // corrida: outro request pode ter criado
      if (!user) throw new Error('Falha ao criar participante');
    } else if (user.consentVersion !== input.consentVersion) {
      await this.d.users.updateConsent(user.id, input.consentVersion, now);
    }

    const device: Device = {
      id: this.d.ids.uuid(),
      userId: user.id,
      platform: input.platform,
      installationId: input.installationId,
      trust: 'TRUSTED',
      untrustedReason: null,
      appAttest: verified.appAttest,
      active: true,
      createdAt: now,
    };
    await this.d.devices.replaceActiveDevice(device, verified.receipt);
    await this.d.sessions.revokeAllForUser(user.id, now);

    const refresh = this.d.tokens.newRefreshToken();
    const sessionId = this.d.ids.uuid();
    await this.d.sessions.insert({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: refresh.hash,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      revokedAt: null,
    });
    const access = await this.d.tokens.issueAccessToken({ userId: user.id, sessionId });
    return {
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken: refresh.token,
      userId: user.id,
      deviceId: device.id,
    };
  }

  private async verify(
    input: EnrollDeviceInput,
    clientData: string,
  ): Promise<{ appAttest: Device['appAttest']; receipt?: Buffer }> {
    const att = input.attestation;
    const untrusted = () =>
      new DomainError(
        'DEVICE_NOT_TRUSTED',
        'Este aparelho não passou na verificação de integridade da Apple/Google (emulador, sistema modificado ou app fora da loja oficial). Ele pode acompanhar os atos, mas não registrar presença nem apoio.',
      );

    if (att.kind === 'unsupported') throw untrusted();

    if (att.kind === 'ios') {
      if (input.platform !== 'ios') throw new DomainError('VALIDATION', 'Atestação incompatível com a plataforma.');
      const res = await this.d.ios.verifyAttestation({ keyId: att.keyId, attestationB64: att.attestation, clientData });
      if (!res.ok || !res.publicKeyPem || !res.environment) throw untrusted();
      return {
        appAttest: { keyId: att.keyId, publicKeyPem: res.publicKeyPem, signCount: 0, environment: res.environment },
        receipt: res.receipt,
      };
    }

    if (input.platform !== 'android') throw new DomainError('VALIDATION', 'Atestação incompatível com a plataforma.');
    const check = await this.d.android.verify({
      integrityToken: att.integrityToken,
      expectedRequestHash: this.d.payloadHasher.sha256Base64(clientData),
    });
    if (!check.ok && check.failure === 'PROVIDER_UNAVAILABLE') {
      throw new DomainError('ATTESTATION_UNAVAILABLE', 'Verificação de integridade indisponível. Tente novamente.');
    }
    if (!check.ok) throw untrusted();
    return { appAttest: null };
  }
}

// ---------------------------------------------------------------------------

export class RefreshSession {
  constructor(private readonly d: { sessions: SessionRepository; tokens: TokenService; clock: Clock }) {}

  /** Rotação: cada refresh token só vale uma vez. */
  async execute(input: { refreshToken: string }): Promise<AuthTokens> {
    const now = this.d.clock.now();
    const session = await this.d.sessions.findByRefreshHash(this.d.tokens.hashRefreshToken(input.refreshToken));
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new DomainError('UNAUTHENTICATED', 'Sessão expirada.');
    }
    const refresh = this.d.tokens.newRefreshToken();
    await this.d.sessions.rotate(session.id, refresh.hash, new Date(now.getTime() + SESSION_TTL_MS));
    const access = await this.d.tokens.issueAccessToken({ userId: session.userId, sessionId: session.id });
    return {
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken: refresh.token,
      userId: session.userId,
    };
  }
}
