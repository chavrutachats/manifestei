const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}h${pad(d.getMinutes())}`;

/** "sáb, 15 nov, 14h00 às 18h00" — sem depender de Intl (Hermes). */
export function formatEventWhen(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const day = `${WEEKDAYS[s.getDay()]}, ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  return sameDay
    ? `${day}, ${hm(s)} às ${hm(e)}`
    : `${day}, ${hm(s)} até ${e.getDate()} ${MONTHS[e.getMonth()]}, ${hm(e)}`;
}

export const formatClock = (iso: string | Date): string => hm(new Date(iso));

/** 135 → "2h15"; 40 → "40 min". */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function formatArea(m2: number): string {
  if (m2 >= 100_000) return `${(m2 / 1_000_000).toFixed(2).replace('.', ',')} km²`;
  return `${String(Math.round(m2 / 100) * 100).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} m²`;
}

/** Mesma janela da API (CHECKIN_OPENS_BEFORE_START / CLOSES_AFTER_END). O servidor é quem decide; isto só guia a tela. */
export function isCheckInOpen(e: { startsAt: string; endsAt: string; phase: string }, now = Date.now()): boolean {
  if (e.phase === 'CANCELLED') return false;
  return now >= new Date(e.startsAt).getTime() - 60 * 60_000 && now <= new Date(e.endsAt).getTime() + 30 * 60_000;
}
