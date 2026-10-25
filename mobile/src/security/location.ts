import * as Location from 'expo-location';
import { Platform } from 'react-native';

export type PreciseLocationPermission = 'granted' | 'denied' | 'imprecise';

/**
 * Permissão de localização PRECISA, só "durante o uso".
 * iOS 14+ e Android 12+ deixam a pessoa conceder apenas a aproximada
 * (precisão de quilômetros): isso não serve para geocerca.
 */
export async function ensurePreciseLocationPermission(opts: { ask?: boolean } = {}): Promise<PreciseLocationPermission> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain && (opts.ask ?? true)) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return 'denied';
  if (Platform.OS === 'ios' && perm.ios?.accuracy === 'reduced') return 'imprecise';
  if (Platform.OS === 'android' && perm.android?.accuracy !== 'fine') return 'imprecise';
  return 'granted';
}

/** Posição aproximada só para centralizar o mapa (criação de ato). Nunca enviada à API. */
export async function roughPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return null;
  }
}
