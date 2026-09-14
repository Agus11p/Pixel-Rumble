import { supabase } from './supabase';
import type { Room, RoomPlayer } from './types';

export type RoomErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'ROOM_NOT_FOUND'
  | 'BAD_PASSWORD'
  | 'COLOR_TAKEN'
  | 'MATCH_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_A_PLAYER'
  | 'CODE_EXHAUSTED'
  | 'NEED_MORE_PLAYERS'
  | 'UNKNOWN';

const KNOWN_CODES: RoomErrorCode[] = [
  'NOT_AUTHENTICATED',
  'ROOM_NOT_FOUND',
  'BAD_PASSWORD',
  'COLOR_TAKEN',
  'MATCH_IN_PROGRESS',
  'NOT_HOST',
  'NOT_A_PLAYER',
  'CODE_EXHAUSTED',
  'NEED_MORE_PLAYERS',
];

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

/** Traduce el error crudo de Postgres al codigo que la UI sabe mostrar. */
function toRoomError(error: { message?: string } | null): RoomError {
  const raw = error?.message ?? '';
  const found = KNOWN_CODES.find((c) => raw.includes(c));
  return new RoomError(found ?? 'UNKNOWN', raw || 'Error desconocido');
}

export const ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  NOT_AUTHENTICATED: 'No se pudo iniciar sesión. Recargá la página.',
  ROOM_NOT_FOUND: 'No existe ninguna sala con ese código.',
  BAD_PASSWORD: 'Contraseña incorrecta.',
  COLOR_TAKEN: 'Ese color ya lo tomó otro jugador.',
  MATCH_IN_PROGRESS: 'La partida ya empezó.',
  NOT_HOST: 'Solo el host puede cambiar la configuración.',
  NOT_A_PLAYER: 'Los espectadores no pueden hacer eso.',
  CODE_EXHAUSTED: 'No se pudo generar un código libre. Probá de nuevo.',
  NEED_MORE_PLAYERS: 'Hacen falta al menos 2 jugadores para empezar.',
  UNKNOWN: 'Algo salió mal. Probá de nuevo.',
};

interface RoomRow {
  id: string;
  code: string;
  host_id: string;
  target_points: number;
  round_seconds: number;
  status: string;
}

interface PlayerRow {
  user_id: string;
  name: string;
  color: number;
  role: string;
  join_order: number;
  score: number;
}

export function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    targetPoints: row.target_points,
    roundSeconds: row.round_seconds,
    status: row.status === 'in_match' ? 'in_match' : 'lobby',
  };
}

function mapPlayer(row: PlayerRow): RoomPlayer {
  return {
    userId: row.user_id,
    name: row.name,
    color: row.color,
    role: row.role === 'spectator' ? 'spectator' : 'player',
    joinOrder: Number(row.join_order),
    score: row.score,
  };
}

export async function createRoom(params: {
  name: string;
  password?: string;
  targetPoints: number;
  roundSeconds: number;
}): Promise<{ roomId: string; code: string }> {
  const { data, error } = await supabase().rpc('create_room', {
    p_name: params.name,
    p_password: params.password?.trim() || null,
    p_target: params.targetPoints,
    p_seconds: params.roundSeconds,
  });
  if (error) throw toRoomError(error);
  const row = (data as { room_id: string; code: string }[])[0];
  if (!row) throw new RoomError('UNKNOWN', 'La sala no devolvió datos');
  return { roomId: row.room_id, code: row.code };
}

export async function joinRoom(params: {
  code: string;
  name: string;
  password?: string;
}): Promise<{ roomId: string; role: string; color: number }> {
  const { data, error } = await supabase().rpc('join_room', {
    p_code: params.code,
    p_name: params.name,
    p_password: params.password?.trim() || null,
  });
  if (error) throw toRoomError(error);
  const row = (data as { room_id: string; role: string; color: number }[])[0];
  if (!row) throw new RoomError('ROOM_NOT_FOUND', 'La sala no devolvió datos');
  return { roomId: row.room_id, role: row.role, color: row.color };
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const { data, error } = await supabase()
    .from('rooms')
    .select('id, code, host_id, target_points, round_seconds, status')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw toRoomError(error);
  return data ? mapRoom(data as RoomRow) : null;
}

export async function fetchPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase()
    .from('room_players')
    .select('user_id, name, color, role, join_order, score')
    .eq('room_id', roomId)
    .order('join_order');
  if (error) throw toRoomError(error);
  return (data as PlayerRow[]).map(mapPlayer);
}

export async function setColor(roomId: string, color: number): Promise<void> {
  const { error } = await supabase().rpc('set_color', { p_room: roomId, p_color: color });
  if (error) throw toRoomError(error);
}

export async function setConfig(roomId: string, target: number, seconds: number): Promise<void> {
  const { error } = await supabase().rpc('set_config', {
    p_room: roomId,
    p_target: target,
    p_seconds: seconds,
  });
  if (error) throw toRoomError(error);
}

export async function leaveRoom(roomId: string): Promise<void> {
  const { error } = await supabase().rpc('leave_room', { p_room: roomId });
  if (error) throw toRoomError(error);
}

export async function claimHost(roomId: string): Promise<boolean> {
  const { data, error } = await supabase().rpc('claim_host', { p_room: roomId });
  if (error) throw toRoomError(error);
  return data === true;
}

export async function startMatch(roomId: string): Promise<void> {
  const { error } = await supabase().rpc('start_match', { p_room: roomId });
  if (error) throw toRoomError(error);
}

export async function endMatch(roomId: string): Promise<void> {
  const { error } = await supabase().rpc('end_match', { p_room: roomId });
  if (error) throw toRoomError(error);
}

/** Entre rondas: los espectadores que esperan pasan a jugar si hay lugar. */
export async function promoteSpectators(roomId: string): Promise<number> {
  const { data, error } = await supabase().rpc('promote_spectators', { p_room: roomId });
  if (error) throw toRoomError(error);
  return (data as number) ?? 0;
}

export async function heartbeatHost(roomId: string): Promise<void> {
  // Un latido perdido no es un problema: el siguiente llega en 5 s.
  await supabase().rpc('heartbeat_host', { p_room: roomId });
}
