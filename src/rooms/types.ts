import { DEFAULT_MAP_ID, listMaps } from '../core/maps/registry';
import { SCORING } from '../core/scoring';

export type RoomStatus = 'lobby' | 'in_match';
export type PlayerRole = 'player' | 'spectator';

export interface Room {
  id: string;
  code: string;
  hostId: string;
  /** Que mapa se juega. Es un mapId del registry (`core/maps/registry.ts`). */
  mapId: string;
  /** Puntos para ganar la partida. */
  targetPoints: number;
  roundSeconds: number;
  status: RoomStatus;
}

export interface RoomPlayer {
  userId: string;
  name: string;
  /** -1 = espectador sin color. */
  color: number;
  role: PlayerRole;
  joinOrder: number;
  score: number;
}

export const TARGET_OPTIONS = SCORING.targetOptions;
export const TIME_OPTIONS = [30, 45, 60, 90] as const;
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS_TO_START = 2;

/** Mapas que se pueden elegir al crear/configurar una sala, en orden fijo. */
export const MAP_OPTIONS = listMaps().map((m) => m.id);
/** Nombre para mostrar de cada mapId, para el selector (sin thumbnails todavia). */
export const MAP_LABELS: Record<string, string> = Object.fromEntries(
  listMaps().map((m) => [m.id, m.name]),
);
export { DEFAULT_MAP_ID };
