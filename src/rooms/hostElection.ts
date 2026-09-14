import type { Room, RoomPlayer } from './types';

/**
 * Eleccion de host, deterministica: gana el conectado con menor join_order.
 *
 * Que sea deterministica es el punto entero: todos los clientes calculan el
 * MISMO sucesor sin negociar nada, asi que no hay ventana en la que dos
 * navegadores se crean host al mismo tiempo. La base confirma con claim_host().
 */
export function electHost(
  players: readonly RoomPlayer[],
  connected: ReadonlySet<string>,
): string | null {
  const candidates = players
    .filter((p) => connected.has(p.userId))
    .sort((a, b) => a.joinOrder - b.joinOrder);
  return candidates[0]?.userId ?? null;
}

/** Solo el sucesor electo intenta reclamar, y solo si el host ya no esta. */
export function shouldClaimHost(
  room: Room,
  players: readonly RoomPlayer[],
  connected: ReadonlySet<string>,
  myId: string,
): boolean {
  if (room.hostId === myId) return false;
  if (connected.has(room.hostId)) return false;
  return electHost(players, connected) === myId;
}
