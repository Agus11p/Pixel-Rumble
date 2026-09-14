import {
  AIR_ACCEL,
  AIR_FRICTION,
  APEX_MULT,
  APEX_THRESHOLD,
  COYOTE_TICKS,
  DEATH_MARGIN,
  DT,
  FALL_MULT,
  GRAVITY,
  GROUND_FRICTION,
  JUMP_BUFFER_TICKS,
  JUMP_CUT_SPEED,
  JUMP_SPEED,
  MAX_FALL,
  MAX_RUN,
  RUN_ACCEL,
  VIRTUAL_H,
} from './constants';
import { objectsToGeometry } from './objects/catalog';
import { approach, moveX, moveY, overlaps, playerRect } from './physics';
import { NEUTRAL_INPUT } from './types';
import type {
  GameMap,
  InputState,
  InputsByPlayer,
  PlacedObject,
  PlayerState,
  World,
} from './types';

export function createPlayer(map: GameMap, id: string, slot: number): PlayerState {
  const spawn = map.spawns[slot % map.spawns.length]!;
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    jumping: false,
    phase: 'racing',
    endTick: -1,
    killedBy: null,
    groundFriction: 1,
    anim: 'idle',
  };
}

/**
 * Arma el mundo de una ronda.
 *
 * La geometria (mapa base + objetos colocados) se calcula una sola vez aca:
 * durante la carrera no cambia, asi que la simulacion no recalcula nada por
 * tick por mas objetos que haya acumulados.
 */
export function createWorld(
  map: GameMap,
  ids: readonly string[] = ['local'],
  objects: readonly PlacedObject[] = [],
): World {
  const geometry = objectsToGeometry(objects);
  return {
    tick: 0,
    players: ids.map((id, i) => createPlayer(map, id, i)),
    map,
    objects: [...objects],
    solids: [...map.solids, ...geometry.solids],
    hazards: [...map.hazards, ...geometry.hazards],
  };
}

/** Vuelve al estado inicial conservando mapa, objetos y jugadores. */
export function resetWorld(world: World): void {
  world.tick = 0;
  world.players = world.players.map((p, i) => createPlayer(world.map, p.id, i));
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}

/** Copia profunda del estado mutable. La usa el rollback para volver atras. */
export function cloneWorldState(world: World): PlayerState[] {
  return world.players.map(clonePlayer);
}

export function restoreWorldState(world: World, tick: number, players: PlayerState[]): void {
  world.tick = tick;
  world.players = players.map(clonePlayer);
}

export function findPlayer(world: World, id: string): PlayerState | undefined {
  return world.players.find((p) => p.id === id);
}

/**
 * Avanza la simulacion exactamente un tick para TODOS los jugadores.
 *
 * Funcion determinista: mismo estado + mismos inputs => mismo resultado en
 * cualquier maquina. Solo usa +, -, *, / y Math.min/max/abs/ceil, que la norma
 * IEEE-754 define bit a bit; nada de sin, cos ni sqrt. Por eso dos navegadores
 * distintos pueden simular la misma carrera y no separarse ni un pixel, que es
 * la base de todo el multijugador.
 *
 * Muta `world` a proposito: el rollback re-simula cientos de ticks por segundo
 * y clonar en cada uno seria un desperdicio.
 */
export function step(world: World, inputs: InputsByPlayer): void {
  world.tick++;
  for (const player of world.players) {
    stepPlayer(world, player, inputs[player.id] ?? NEUTRAL_INPUT);
  }
}

function stepPlayer(world: World, p: PlayerState, input: InputState): void {
  // Muerto o en meta: el personaje queda quieto pero visible.
  if (p.phase !== 'racing') {
    p.vx = 0;
    p.vy = 0;
    p.anim = 'idle';
    p.jumpHeld = input.jump;
    return;
  }

  // --- horizontal -----------------------------------------------------------
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    const accel = p.onGround ? RUN_ACCEL * p.groundFriction : AIR_ACCEL;
    p.vx = approach(p.vx, dir * MAX_RUN, accel * DT);
    p.facing = dir > 0 ? 1 : -1;
  } else {
    const friction = p.onGround ? GROUND_FRICTION * p.groundFriction : AIR_FRICTION;
    p.vx = approach(p.vx, 0, friction * DT);
  }

  // --- salto ----------------------------------------------------------------
  // El buffer se carga con el FLANCO de la tecla, no con el estado sostenido:
  // mantener salto no encola saltos infinitos.
  const jumpPressed = input.jump && !p.jumpHeld;
  if (jumpPressed) p.jumpBuffer = JUMP_BUFFER_TICKS;
  else if (p.jumpBuffer > 0) p.jumpBuffer--;

  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_SPEED;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.jumping = true;
  }

  // Salto de altura variable: soltar el boton recorta el impulso.
  // Solo aplica al salto propio (p.jumping), nunca a un impulso externo.
  if (p.jumping && p.vy < 0 && !input.jump && p.vy < -JUMP_CUT_SPEED) {
    p.vy = -JUMP_CUT_SPEED;
    p.jumping = false;
  }

  // --- gravedad -------------------------------------------------------------
  let g = GRAVITY;
  if (p.vy > 0) g *= FALL_MULT;
  if (Math.abs(p.vy) < APEX_THRESHOLD) g *= APEX_MULT;
  p.vy = Math.min(p.vy + g * DT, MAX_FALL);

  // --- movimiento y colisiones ---------------------------------------------
  p.onGround = false;
  moveX(p, p.vx * DT, world.solids);
  moveY(p, p.vy * DT, world.solids);
  if (!p.onGround) p.groundFriction = 1;

  if (p.vy >= 0 || p.onGround) p.jumping = false;

  // --- coyote time ----------------------------------------------------------
  if (p.onGround) p.coyote = COYOTE_TICKS;
  else if (p.coyote > 0) p.coyote--;

  // --- resultado del tick ---------------------------------------------------
  const box = playerRect(p);

  if (p.y > VIRTUAL_H + DEATH_MARGIN) {
    kill(p, world.tick, null);
  } else {
    for (const h of world.hazards) {
      if (overlaps(box, h)) {
        kill(p, world.tick, h.ownerId ?? null);
        break;
      }
    }
  }

  if (p.phase === 'racing' && overlaps(box, world.map.goal)) {
    p.phase = 'finished';
    p.endTick = world.tick;
  }

  // --- animacion ------------------------------------------------------------
  if (p.phase === 'racing') {
    if (!p.onGround) p.anim = p.vy < 0 ? 'jump' : 'fall';
    else p.anim = Math.abs(p.vx) > 6 ? 'run' : 'idle';
  }

  p.jumpHeld = input.jump;
}

function kill(p: PlayerState, tick: number, killedBy: string | null): void {
  p.phase = 'dead';
  p.endTick = tick;
  // Una trampa nunca le da puntos a su propio dueno (§26).
  p.killedBy = killedBy === p.id ? null : killedBy;
  p.vx = 0;
  p.vy = 0;
  p.anim = 'fall';
}

/** La ronda termina cuando nadie sigue corriendo. */
export function everyoneDone(world: World): boolean {
  return world.players.every((p) => p.phase !== 'racing');
}
