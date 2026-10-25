import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateEventInput, PresenceSampleResult } from '../domain/types';
import { confirmPresence } from '../features/presence/confirmPresence';
import { api } from './api';

export const qk = {
  events: ['events'] as const,
  event: (id: string) => ['event', id] as const,
  myAttendance: (id: string) => ['event', id, 'me'] as const,
  me: ['me'] as const,
};

export const useEvents = () =>
  useQuery({ queryKey: qk.events, queryFn: async () => (await api.listEvents()).events, refetchInterval: 30_000 });

/** Contagem ao vivo: atualiza a cada 15 s enquanto a tela está aberta. */
export const useEvent = (id: string) =>
  useQuery({ queryKey: qk.event(id), queryFn: () => api.getEvent(id), refetchInterval: 15_000 });

/** Pico e permanência: o servidor recalcula a cada 30 s; aqui basta a cada 60 s. */
export const useEventTimeline = (id: string) =>
  useQuery({ queryKey: ['event', id, 'timeline'] as const, queryFn: () => api.getTimeline(id), refetchInterval: 60_000 });

export const useMyAttendance = (id: string, enabled = true) =>
  useQuery({ queryKey: qk.myAttendance(id), queryFn: () => api.myAttendance(id), enabled });

export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: api.me, enabled });

/** "Estou no ato": um toque. */
export function useConfirmPresence(eventId: string) {
  const qc = useQueryClient();
  return useMutation<PresenceSampleResult, Error>({
    mutationFn: () => confirmPresence(eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myAttendance(eventId) });
      void qc.invalidateQueries({ queryKey: qk.event(eventId) });
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

/** "Apoiar à distância": um toque, idempotente no servidor. */
export function useDeclareVirtualSupport(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.declareVirtualSupport(eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.myAttendance(eventId) });
      void qc.invalidateQueries({ queryKey: qk.event(eventId) });
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.events }),
  });
}

export function useCancelEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelEvent(eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.event(eventId) });
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}
