import type { GameMap } from '../types';
import { MAP_ASCENSO } from './ascenso';
import { MAP_CRYSTAL_CHAOS } from './crystalChaos';
import { MAP_TEST } from './testMap';
import { assertValidMap } from './validate';

/**
 * Registro central de mapas.
 *
 * Este es el UNICO lugar donde el juego sabe que mapas existen. El resto del
 * codigo (MatchSession, la UI, los tests) trabaja con un `mapId` (string) o
 * con la `GameMap` que este registry resuelve - nunca importa una definicion
 * de mapa a mano.
 *
 * Agregar un mapa nuevo es: escribir su archivo en `core/maps/`, sumarlo aca
 * abajo, listo. No hace falta tocar fisica, rollback, MatchSession, render ni
 * scoring.
 */
const ALL_MAPS: readonly GameMap[] = [MAP_ASCENSO, MAP_CRYSTAL_CHAOS, MAP_TEST];

// Se valida una sola vez, al cargar el modulo: un mapa mal definido rompe el
// build/los tests de entrada, no aparece como un bug raro en una partida real.
for (const map of ALL_MAPS) assertValidMap(map);

const REGISTRY = new Map<string, GameMap>(ALL_MAPS.map((m) => [m.id, m]));

/** Mapa con el que arranca cualquier sala nueva. */
export const DEFAULT_MAP_ID: string = MAP_ASCENSO.id;

/** Lista de mapas disponibles, en el orden en que se registraron. */
export function listMaps(): readonly GameMap[] {
  return ALL_MAPS;
}

/** Busqueda simple, sin lanzar: `undefined` si el id no existe. */
export function getMap(mapId: string): GameMap | undefined {
  return REGISTRY.get(mapId);
}

export function isValidMapId(mapId: string): boolean {
  return REGISTRY.has(mapId);
}

/**
 * Resuelve un mapId a su definicion, o explota con un mensaje claro.
 *
 * Se usa donde el mapa es obligatorio para poder arrancar (MatchSession, el
 * driver local): si alguna vez un cliente recibe un mapId que su propio
 * registry no reconoce (una sala vieja, un id con un typo, una version
 * desincronizada), es mejor fallar fuerte y explicito que construir un mundo
 * con un mapa a medias.
 */
export function resolveMap(mapId: string): GameMap {
  const map = REGISTRY.get(mapId);
  if (!map) {
    const known = ALL_MAPS.map((m) => m.id).join(', ');
    throw new Error(`Mapa desconocido: "${mapId}". Mapas disponibles: ${known}`);
  }
  return map;
}
