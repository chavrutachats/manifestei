/**
 * Erros de domínio. A camada HTTP traduz `code` para status HTTP;
 * nenhuma regra de negócio conhece HTTP.
 */
export type DomainErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CHALLENGE_INVALID'
  | 'RATE_LIMITED'
  | 'DEVICE_NOT_REGISTERED'
  | 'EVENT_CLOSED'
  | 'CONSENT_REQUIRED'
  /** Aparelho reprovado na atestação: emulador, sistema modificado ou app fora da loja. */
  | 'DEVICE_NOT_TRUSTED'
  /** Provedor de atestação (Google/Apple) indisponível: falha temporária, não é culpa do usuário. */
  | 'ATTESTATION_UNAVAILABLE';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
