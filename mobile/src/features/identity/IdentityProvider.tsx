import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { config } from '../../config';
import { session } from '../../data/http';
import { secureStorage } from '../../data/secureStorage';
import { EnrollmentError, enrollDevice } from '../../security/enrollment';

/**
 * Não existe login. Existe:
 *  - needsConsent: primeira vez (ou termo mudou) → tela de consentimento
 *  - enrolling:    verificando o aparelho com a Apple/Google
 *  - ready:        pode registrar presença e apoio
 *  - untrusted:    aparelho reprovado (emulador, root, app fora da loja): só acompanha
 *  - error:        falha passageira (rede, serviço fora) ou bloqueio após apagar dados
 */
export type IdentityStatus = 'starting' | 'needsConsent' | 'enrolling' | 'ready' | 'untrusted' | 'error';

interface IdentityValue {
  status: IdentityStatus;
  error: string | null;
  acceptConsent(): Promise<void>;
  retry(): Promise<void>;
  /** Depois de "apagar meus dados": volta ao início, sem sessão nem consentimento. */
  forget(): Promise<void>;
}

const IdentityContext = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<IdentityStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const enroll = useCallback(async () => {
    setStatus('enrolling');
    setError(null);
    try {
      await enrollDevice();
      setStatus('ready');
    } catch (err) {
      const e = err instanceof EnrollmentError ? err : new EnrollmentError('UNKNOWN', 'Não foi possível verificar o aparelho.');
      setError(e.message);
      setStatus(e.failure === 'UNTRUSTED' ? 'untrusted' : 'error');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const accepted = await secureStorage.getAcceptedConsent();
      if (!mounted) return;
      if (accepted !== config.consentVersion) return setStatus('needsConsent');
      if (await session.restore()) return mounted && setStatus('ready');
      if (mounted) await enroll();
    })();
    // Sessão revogada (ex.: o app foi reinstalado em outro momento): rematricula em silêncio.
    const off = session.onSignedOut(() => void enroll());
    return () => {
      mounted = false;
      off();
    };
  }, [enroll]);

  const acceptConsent = useCallback(async () => {
    await secureStorage.setAcceptedConsent(config.consentVersion);
    await enroll();
  }, [enroll]);

  const forget = useCallback(async () => {
    await session.end();
    await secureStorage.clearAcceptedConsent();
    queryClient.clear();
    setError(null);
    setStatus('needsConsent');
  }, [queryClient]);

  const value = useMemo(() => ({ status, error, acceptConsent, retry: enroll, forget }), [status, error, acceptConsent, enroll, forget]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error('useIdentity fora do IdentityProvider');
  return ctx;
}
