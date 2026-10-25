import * as Location from 'expo-location';
import { PermissionsAndroid, Platform } from 'react-native';
import { secureStorage } from '../../data/secureStorage';
import type { PresenceSampleResult } from '../../domain/types';
import { PresenceError, confirmPresence } from './confirmPresence';
import {
  CHECK_IN_CLOSES_AFTER_END_MS,
  RETRY_SOON_MS,
  applyResult,
  type PresenceSession,
  type SessionEndReason,
} from './sessionRules';

export type { PresenceSession, SessionEndReason } from './sessionRules';

/**
 * Registro automático de presença.
 *
 * A pessoa toca UMA vez em "Estou no ato". Daí em diante o app, sozinho:
 *  - faz uma leitura atestada a cada `sampleInterval` (15 min no padrão), com o app
 *    aberto, em segundo plano ou com a tela bloqueada;
 *  - a presença é confirmada pelo servidor quando há 2 leituras válidas com 45 min;
 *  - continua lendo depois de confirmar, para medir quanto tempo a pessoa ficou
 *    (isso alimenta o pico, a queda e o tempo médio do ato);
 *  - encerra sozinho quando a pessoa sai da área (2 leituras seguidas fora),
 *    quando o ato termina, ou quando ela toca em "Parar".
 *
 * Nada disso é escondido: o sistema mostra o indicador de localização (iOS) e uma
 * notificação fixa (Android) enquanto o registro está ativo. É exigência das lojas
 * e também é o certo a fazer num app sobre participação política.
 */

export const PRESENCE_TASK = 'manifestei-presence-session';

type Listener = (s: PresenceSession | null) => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;

export function subscribePresenceSession(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function load(): Promise<PresenceSession | null> {
  try {
    const raw = await secureStorage.getPresenceSession();
    return raw ? (JSON.parse(raw) as PresenceSession) : null;
  } catch {
    return null;
  }
}

async function save(s: PresenceSession | null): Promise<void> {
  if (s) await secureStorage.setPresenceSession(JSON.stringify(s));
  else await secureStorage.clearPresenceSession();
  listeners.forEach((fn) => fn(s));
}

export const getPresenceSession = load;

const isActive = (s: PresenceSession | null): s is PresenceSession => !!s && !s.ended;

// ----------------------------------------------------------------------------- liga/desliga

async function startLocationUpdates(title: string, intervalMinutes: number): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK)) return;
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    // Android 13+: sem esta permissão a notificação do registro não aparece na barra.
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
  }
  // Economia de bateria: entre as leituras, NADA de GPS. Só a localização mais barata
  // que o sistema tem (antenas de celular, ~3 km), que serve apenas para o sistema
  // manter o registro vivo e acordar o app. A leitura que vale é uma rajada curta
  // de GPS de alta precisão, uma vez a cada intervalo, feita à parte.
  const intervalMs = intervalMinutes * 60_000;
  await Location.startLocationUpdatesAsync(PRESENCE_TASK, {
    accuracy: Platform.OS === 'ios' ? Location.Accuracy.Low : Location.Accuracy.Lowest,
    // Android: o sistema só acorda o app perto da hora da próxima leitura.
    timeInterval: Math.max(60_000, intervalMs - 60_000),
    distanceInterval: 0,
    // iOS: agrupa entregas para acordar o JavaScript no máximo a cada ~5 min.
    deferredUpdatesInterval: Math.min(5 * 60_000, intervalMs),
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Registrando sua presença no ato',
      notificationBody: `${title}: conferimos sua localização a cada ${intervalMinutes} min enquanto você estiver no local. Toque para abrir ou parar.`,
      notificationColor: '#3343B5',
      killServiceOnDestroy: false,
    },
  });
}

async function stopLocationUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(PRESENCE_TASK)) {
      await Location.stopLocationUpdatesAsync(PRESENCE_TASK);
    }
  } catch {
    // tarefa já parada pelo sistema
  }
}

/**
 * Chamado logo depois do toque em "Estou no ato", com o app na tela (o sistema
 * só deixa iniciar o registro em segundo plano a partir do primeiro plano).
 */
export async function startPresenceSession(
  event: { id: string; title: string; endsAt: string },
  first: PresenceSampleResult,
): Promise<void> {
  const current = await load();
  if (isActive(current) && current.eventId !== event.id) await stopPresenceSession('STOPPED_BY_USER');

  const now = Date.now();
  const intervalMs = Math.max(5 * 60_000, first.sampleIntervalSeconds * 1000);
  const session: PresenceSession = {
    eventId: event.id,
    eventTitle: event.title,
    startedAt: now,
    closesAt: new Date(event.endsAt).getTime() + CHECK_IN_CLOSES_AFTER_END_MS,
    intervalMs,
    nextReadingAt: now + intervalMs,
    lastReadingAt: now,
    lastStatus: first.status,
    consecutiveOutside: 0,
    notice: null,
    ended: null,
  };
  await save(session);
  await startLocationUpdates(event.title, Math.round(intervalMs / 60_000));
}

export async function stopPresenceSession(reason: SessionEndReason = 'STOPPED_BY_USER'): Promise<void> {
  await stopLocationUpdates();
  const s = await load();
  if (s && !s.ended) await save({ ...s, ended: { reason, at: Date.now() } });
}

/** Ao abrir o app: religa o registro se o sistema o encerrou (reinício, app fechado à força). */
export async function resumePresenceSessionIfNeeded(): Promise<void> {
  const s = await load();
  if (!isActive(s)) return;
  if (Date.now() > s.closesAt) return stopPresenceSession('EVENT_ENDED');
  try {
    await startLocationUpdates(s.eventTitle, Math.round(s.intervalMs / 60_000));
  } catch {
    // sem permissão no momento: a leitura abaixo vai explicar
  }
  await runDueReading();
}

// ----------------------------------------------------------------------------- leitura agendada

/**
 * Executada pela tarefa de localização (a cada ~1 min, em segundo plano) e ao
 * voltar para o app. Só faz a leitura atestada quando está na hora.
 */
export function runDueReading(force = false): Promise<void> {
  running ??= doRunDueReading(force).finally(() => {
    running = null;
  });
  return running;
}

async function doRunDueReading(force: boolean): Promise<void> {
  const s = await load();
  if (!isActive(s)) {
    await stopLocationUpdates();
    return;
  }
  const now = Date.now();
  if (now > s.closesAt) return stopPresenceSession('EVENT_ENDED');
  if (!force && now < s.nextReadingAt) return;

  let result: PresenceSampleResult;
  try {
    result = await confirmPresence(s.eventId, { interactive: false });
  } catch (err) {
    const e = err instanceof PresenceError ? err : new PresenceError('UNKNOWN', 'Falha na leitura.');
    if (e.failure === 'EVENT_CLOSED') return stopPresenceSession('EVENT_ENDED');
    if (e.failure === 'LOCATION_DENIED' || e.failure === 'LOCATION_IMPRECISE') return endWith(s, 'PERMISSION', e.message);
    if (e.failure === 'DEVICE_UNTRUSTED') return endWith(s, 'DEVICE_UNTRUSTED', e.message);
    await save({ ...s, nextReadingAt: now + RETRY_SOON_MS, notice: e.message });
    return;
  }

  const next = applyResult(s, result, now);
  await save(next);
  if (next.ended) await stopLocationUpdates();
}

async function endWith(s: PresenceSession, reason: SessionEndReason, notice: string): Promise<void> {
  await stopLocationUpdates();
  await save({ ...s, notice, ended: { reason, at: Date.now() } });
}
