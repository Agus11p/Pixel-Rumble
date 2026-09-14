import { GRID, PLAYER_H, PLAYER_W, VIRTUAL_H, VIRTUAL_W } from '../constants';
import { overlaps } from '../physics';
import type { GameMap, PlacedObject, Rect } from '../types';
import { objectParts, objectSize, objectType } from './catalog';

/** Margen alrededor de la salida y de la meta donde no se puede construir. */
const SAFE_MARGIN = 10;

export type PlacementError =
  | 'FUERA_DEL_MAPA'
  | 'SOBRE_EL_TERRENO'
  | 'SOBRE_OTRO_OBJETO'
  | 'ZONA_PROTEGIDA'
  | 'TIPO_DESCONOCIDO';

export interface PlacementCheck {
  valid: boolean;
  error?: PlacementError;
}

export const PLACEMENT_MESSAGES: Record<PlacementError, string> = {
  FUERA_DEL_MAPA: 'Fuera del mapa',
  SOBRE_EL_TERRENO: 'Encima del terreno',
  SOBRE_OTRO_OBJETO: 'Encima de otro objeto',
  ZONA_PROTEGIDA: 'Muy cerca de la salida o de la meta',
  TIPO_DESCONOCIDO: 'Objeto desconocido',
};

/** Encaja una coordenada en la grilla de colocacion. */
export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * Zonas donde no se puede construir.
 *
 * Sin esto, un jugador puede tapar la meta o encerrar a todos en la salida y
 * arruinar la ronda para todo el mundo. Validar "el mapa sigue siendo
 * terminable" de verdad exigiria resolver el nivel entero, asi que se protege
 * lo critico y el resto se autorregula: si no llega nadie, nadie suma (§26).
 */
function protectedZones(map: GameMap): Rect[] {
  const zones: Rect[] = [
    {
      x: map.goal.x - SAFE_MARGIN,
      y: map.goal.y - SAFE_MARGIN,
      w: map.goal.w + SAFE_MARGIN * 2,
      h: map.goal.h + SAFE_MARGIN * 2,
    },
  ];
  for (const spawn of map.spawns) {
    zones.push({
      x: spawn.x - SAFE_MARGIN,
      y: spawn.y - SAFE_MARGIN,
      w: PLAYER_W + SAFE_MARGIN * 2,
      h: PLAYER_H + SAFE_MARGIN * 2,
    });
  }
  return zones;
}

/** Dice si un objeto se puede colocar ahi, y por que no si no se puede. */
export function checkPlacement(
  candidate: PlacedObject,
  map: GameMap,
  existing: readonly PlacedObject[],
): PlacementCheck {
  const type = objectType(candidate.type);
  if (!type) return { valid: false, error: 'TIPO_DESCONOCIDO' };

  const size = objectSize(type, candidate.rotation);
  const box: Rect = { x: candidate.x, y: candidate.y, w: size.w, h: size.h };

  if (box.x < 0 || box.y < 0 || box.x + box.w > VIRTUAL_W || box.y + box.h > VIRTUAL_H) {
    return { valid: false, error: 'FUERA_DEL_MAPA' };
  }

  for (const zone of protectedZones(map)) {
    if (overlaps(box, zone)) return { valid: false, error: 'ZONA_PROTEGIDA' };
  }

  for (const solid of map.solids) {
    if (overlaps(box, solid)) return { valid: false, error: 'SOBRE_EL_TERRENO' };
  }
  for (const hazard of map.hazards) {
    if (overlaps(box, hazard)) return { valid: false, error: 'SOBRE_EL_TERRENO' };
  }

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    for (const part of objectParts(other)) {
      if (overlaps(box, part)) return { valid: false, error: 'SOBRE_OTRO_OBJETO' };
    }
  }

  return { valid: true };
}

/** Caja que ocupa un objeto colocado, para dibujarlo o compararlo. */
export function objectBounds(placed: PlacedObject): Rect {
  const type = objectType(placed.type);
  if (!type) return { x: placed.x, y: placed.y, w: 0, h: 0 };
  const size = objectSize(type, placed.rotation);
  return { x: placed.x, y: placed.y, w: size.w, h: size.h };
}

/** Paso de la grilla al mover un objeto: mas fino que la grilla del mapa. */
export const PLACE_GRID = 4;
/** A cuantos pixeles de una superficie el objeto se apoya solo encima. */
export const SURFACE_MAGNET = 8;

/**
 * Posicion final de un objeto a partir de donde apunta el jugador.
 *
 * Centra el objeto en el puntero, lo encaja en una grilla de 4 px y, si queda
 * cerca de una superficie, lo apoya justo encima. Sin el iman era imposible
 * poner pinchos, hielo o un resorte sobre una plataforma: las plataformas del
 * mapa no caen en la grilla, asi que el objeto quedaba flotando o metido
 * adentro (y eso es invalido).
 */
export function snapPlacement(
  typeId: string,
  rotation: 0 | 1,
  centerX: number,
  centerY: number,
  map: GameMap,
  existing: readonly PlacedObject[],
): { x: number; y: number } {
  const type = objectType(typeId);
  if (!type) return { x: Math.round(centerX), y: Math.round(centerY) };
  const { w, h } = objectSize(type, rotation);

  const grid = (v: number): number => Math.round(v / PLACE_GRID) * PLACE_GRID;
  const clampX = (v: number): number => Math.min(Math.max(v, 0), VIRTUAL_W - w);
  const clampY = (v: number): number => Math.min(Math.max(v, 0), VIRTUAL_H - h);

  const x = clampX(grid(centerX - w / 2));
  let y = clampY(grid(centerY - h / 2));

  // Superficies donde apoyarse: el terreno visible y los objetos solidos.
  const surfaces: Rect[] = map.solids.filter(
    (s) => s.x >= 0 && s.y >= 0 && s.x < VIRTUAL_W && s.y < VIRTUAL_H,
  );
  for (const other of existing) {
    for (const part of objectParts(other)) {
      if (part.part.kind !== 'hazard') surfaces.push(part);
    }
  }

  let bestGap = Number.POSITIVE_INFINITY;
  for (const s of surfaces) {
    if (s.x >= x + w || s.x + s.w <= x) continue; // no queda encima de esta
    const gap = s.y - (y + h); // >0 flota encima, <0 esta metido adentro
    if (gap < -SURFACE_MAGNET || gap > SURFACE_MAGNET) continue;
    if (Math.abs(gap) < Math.abs(bestGap)) bestGap = gap;
  }
  if (Number.isFinite(bestGap)) y = clampY(y + bestGap);

  return { x, y };
}
