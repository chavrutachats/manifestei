import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getPresenceSession, runDueReading, subscribePresenceSession, type PresenceSession } from './presenceSession';

/** Estado do registro automático para a tela, atualizado a cada leitura. */
export function usePresenceSessionState(eventId: string): PresenceSession | null {
  const [session, setSession] = useState<PresenceSession | null>(null);

  useEffect(() => {
    let mounted = true;
    void getPresenceSession().then((s) => mounted && setSession(s));
    const off = subscribePresenceSession((s) => setSession(s));
    // Voltou para o app: se já passou da hora de uma leitura, faz agora.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void runDueReading();
    });
    return () => {
      mounted = false;
      off();
      sub.remove();
    };
  }, []);

  return session && session.eventId === eventId ? session : null;
}
