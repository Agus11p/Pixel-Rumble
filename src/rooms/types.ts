import { SCORING } from '../core/scoring';

export type RoomStatus = 'lobby' | 'in_match';
export type PlayerRole = 'player' | 'spectator';

export interface Room {
  id: string;
  code: string;
  hostId: string;
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
