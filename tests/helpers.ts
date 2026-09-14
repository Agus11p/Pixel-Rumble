import { step } from '../src/core/simulation';
import type { InputState, InputsByPlayer, PlayerState, World } from '../src/core/types';

/** Id del unico jugador en los tests de un solo personaje. */
export const SOLO = 'local';

/** Envuelve un input suelto como los inputs de la partida entera. */
export function solo(i: InputState): InputsByPlayer {
  return { [SOLO]: i };
}

/** Atajo al jugador de los tests de un solo personaje. */
export function P(world: World): PlayerState {
  return world.players[0]!;
}

export function input(partial: Partial<InputState> = {}): InputState {
  return { left: false, right: false, jump: false, ...partial };
}

export function run(world: World, inp: InputState, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world, solo(inp));
}

/** Corre hasta que se cumpla la condicion o se agoten los ticks. Devuelve los ticks usados. */
export function runUntil(
  world: World,
  inp: InputState,
  predicate: (w: World) => boolean,
  maxTicks = 600,
): number {
  for (let i = 0; i < maxTicks; i++) {
    step(world, solo(inp));
    if (predicate(world)) return i + 1;
  }
  return -1;
}

/** Altura minima (y mas chico) alcanzada durante una secuencia. */
export function minY(world: World, inp: InputState, ticks: number): number {
  let m = P(world).y;
  for (let i = 0; i < ticks; i++) {
    step(world, solo(inp));
    m = Math.min(m, P(world).y);
  }
  return m;
}
