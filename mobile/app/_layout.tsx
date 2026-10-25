import { BigShoulders_800ExtraBold, BigShoulders_900Black, useFonts } from '@expo-google-fonts/big-shoulders';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/data/http';
import { IdentityProvider, useIdentity } from '../src/features/identity/IdentityProvider';
import { color } from '../src/theme';
import { Loading } from '../src/ui/components';

function RootNavigator() {
  const { status } = useIdentity();
  if (status === 'starting') return <Loading />;
  const onboarding = status === 'needsConsent';

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}>
      <Stack.Protected guard={onboarding}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={!onboarding}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // Bateria: com o app fora da tela, nada de atualizar contagens e gráficos pela rede.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => focusManager.setFocused(st === 'active'));
    return () => sub.remove();
  }, []);

  const [fontsLoaded] = useFonts({ BigShoulders_800ExtraBold, BigShoulders_900Black });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // 4xx não melhora repetindo
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );

  if (!fontsLoaded) return <Loading />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <IdentityProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </IdentityProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
