import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIdentity } from '../../src/features/identity/IdentityProvider';
import { resumePresenceSessionIfNeeded } from '../../src/features/presence/presenceSession';
import { color } from '../../src/theme';

export default function AppLayout() {
  const { status } = useIdentity();

  // Se o sistema encerrou o registro automático (reinício do celular, app fechado à
  // força), ele é religado ao abrir o app — só dá para religar com o app na tela.
  useEffect(() => {
    if (status !== 'ready') return;
    void resumePresenceSessionIfNeeded();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void resumePresenceSessionIfNeeded();
    });
    return () => sub.remove();
  }, [status]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color.paper },
        headerShadowVisible: false,
        headerTintColor: color.stamp,
        headerTitleStyle: { color: color.ink, fontWeight: '700' },
        contentStyle: { backgroundColor: color.paper },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Atos' }} />
      <Stack.Screen name="events/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="events/new" options={{ title: 'Novo ato', presentation: 'modal' }} />
      <Stack.Screen name="account" options={{ title: 'Privacidade e aparelho' }} />
    </Stack>
  );
}
