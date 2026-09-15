import { MS_PER_TICK } from '../core/constants';
import { DEFAULT_MAP_ID, resolveMap } from '../core/maps/registry';
import { cloneWorldState, createWorld, resetWorld, step } from '../core/simulation';
import type { InputState, PlayerState, World } from '../core/types';
import type { MatchSession } from '../net/MatchSession';

/**
 * Lo unico que el motor necesita saber para dibujar un frame.
 *
 * Separar esto deja el loop, el render y el input exactamente iguales en el
 * modo de prueba local y en una carrera online: lo que cambia es de donde sale
 * el estado del mundo, no como se muestra.
 */
export interface GameDriver {
  readonly world: World;
  readonly prev: readonly PlayerState[];
  /** Fraccion de tick para interpolar el render. */
  readonly alpha: number;
  update(input: InputState, elapsedMs: number): void;
  restart(): void;
  destroy(): void;
}

/** Si un frame tardo mas que esto (pestana en segundo plano), se descarta el sobrante. */
const MAX_FRAME_MS = 200;
/** Tope de ticks por frame para que un equipo lento no entre en espiral de muerte. */
const MAX_TICKS_PER_FRAME = 8;

/** Un jugador, sin red. Es el prototipo con el que se ajusta la fisica. */
export class LocalDriver implements GameDriver {
  readonly world: World;
  prev: PlayerState[];
  alpha = 0;

  private accumulator = 0;

  constructor(mapId: string = DEFAULT_MAP_ID) {
    this.world = createWorld(resolveMap(mapId), ['local']);
    this.prev = cloneWorldState(this.world);
  }

  update(input: InputState, elapsedMs: number): void {
    this.accumulator += Math.min(elapsedMs, MAX_FRAME_MS);

    let ticks = 0;
    while (this.accumulator >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
      this.accumulator -= MS_PER_TICK;
      ticks++;
      this.prev = cloneWorldState(this.world);
      step(this.world, { local: input });
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0;

    this.alpha = this.accumulator / MS_PER_TICK;
  }

  restart(): void {
    resetWorld(this.world);
    this.prev = cloneWorldState(this.world);
    this.accumulator = 0;
  }

  destroy(): void {}
}

/**
 * Carrera online.
 *
 * No lleva acumulador propio: el tick al que hay que llegar lo dicta el reloj
 * compartido, no el framerate local. Si esta maquina se cuelga medio segundo,
 * al volver simula los ticks que falten y aparece donde tiene que aparecer, en
 * vez de quedar atrasada respecto de los demas.
 */
export class OnlineDriver implements GameDriver {
  constructor(private readonly session: MatchSession) {}

  get world(): World {
    return this.session.sim.world;
  }

  get prev(): readonly PlayerState[] {
    return this.session.sim.prev;
  }

  get alpha(): number {
    return this.session.renderAlpha;
  }

  update(input: InputState): void {
    this.session.update(input);
  }

  /** En online no se reinicia a mano: la ronda la maneja el host. */
  restart(): void {}

  destroy(): void {}
}
