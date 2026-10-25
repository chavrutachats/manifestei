import type { GeoPoint } from './types';

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthMeters(path: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

/** "DD/MM/AAAA" + "HH:MM" no fuso do aparelho → Date, ou null se inválido. */
export function parseLocalDateTime(date: string, time: string): Date | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [day, month, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  const out = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (out.getFullYear() !== year || out.getMonth() !== month - 1 || out.getDate() !== day) return null;
  if (hour > 23 || minute > 59) return null;
  return out;
}
