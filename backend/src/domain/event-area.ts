import type { EventAreaInput } from './entities.js';
import { DomainError } from './errors.js';
import { haversineMeters, isValidGeoPoint, type GeoPoint } from './geo.js';

/**
 * Regras de integridade da ÁREA do evento.
 *
 * A geocerca é o que define "estar no local". Se o organizador pudesse desenhar
 * um círculo de 20 km, metade da cidade contaria como presente sem sair de casa.
 * Por isso a área tem limites duros e é IMUTÁVEL depois de criada (não existe
 * endpoint de edição): ninguém pode "mover a cerca" no meio do ato.
 */
export const AREA_LIMITS = {
  circleMinRadiusM: 50,
  /** ~7 km²: comporta a maior concentração já registrada no país com folga. */
  circleMaxRadiusM: 1500,
  routeMinWidthM: 20,
  /** Largura total do corredor (metade para cada lado do trajeto). */
  routeMaxWidthM: 300,
  routeMaxPoints: 500,
  /** Passeatas longas existem, mas 25 km já é uma marcha de dia inteiro. */
  routeMaxLengthM: 25_000,
} as const;

/**
 * Densidade máxima fisicamente plausível (pessoas/m²). Acima de ~4 p/m² a
 * multidão fica em condição de esmagamento; usamos isso como TETO de sanidade:
 * se o número de presentes verificados ultrapassa área × 4, há algo errado
 * (fraude coordenada, bug ou área mal desenhada) e o evento é sinalizado.
 */
export const MAX_PLAUSIBLE_DENSITY_PER_M2 = 4;

export function routeLengthMeters(path: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

export function validateArea(area: EventAreaInput): void {
  const L = AREA_LIMITS;
  if (area.kind === 'circle') {
    if (!isValidGeoPoint(area.center)) throw new DomainError('VALIDATION', 'Centro do evento inválido.');
    if (!(area.radiusM >= L.circleMinRadiusM && area.radiusM <= L.circleMaxRadiusM)) {
      throw new DomainError('VALIDATION', `Raio deve estar entre ${L.circleMinRadiusM} m e ${L.circleMaxRadiusM} m.`);
    }
    return;
  }
  if (area.path.length < 2 || area.path.length > L.routeMaxPoints) {
    throw new DomainError('VALIDATION', `Trajeto deve ter entre 2 e ${L.routeMaxPoints} pontos.`);
  }
  if (!area.path.every(isValidGeoPoint)) throw new DomainError('VALIDATION', 'Trajeto contém ponto inválido.');
  if (!(area.widthM >= L.routeMinWidthM && area.widthM <= L.routeMaxWidthM)) {
    throw new DomainError('VALIDATION', `Largura do trajeto deve estar entre ${L.routeMinWidthM} m e ${L.routeMaxWidthM} m.`);
  }
  const length = routeLengthMeters(area.path);
  if (length < 50) throw new DomainError('VALIDATION', 'Trajeto curto demais: use uma área circular.');
  if (length > L.routeMaxLengthM) {
    throw new DomainError('VALIDATION', `Trajeto não pode passar de ${L.routeMaxLengthM / 1000} km.`);
  }
}

export interface AreaIntegrity {
  areaM2: number;
  /** Teto físico: área × densidade máxima plausível. */
  maxPlausibleOnSite: number;
  /** true quando presentes (confirmados + pendentes) passam do teto físico. */
  capacityAnomaly: boolean;
}

export function areaIntegrity(areaM2: number, onSite: number): AreaIntegrity {
  const maxPlausibleOnSite = Math.floor(areaM2 * MAX_PLAUSIBLE_DENSITY_PER_M2);
  return { areaM2: Math.round(areaM2), maxPlausibleOnSite, capacityAnomaly: onSite > maxPlausibleOnSite };
}
