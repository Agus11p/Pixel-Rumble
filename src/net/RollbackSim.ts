import { cloneWorldState, createWorld, restoreWorldState, step } from '../core/simulation';
import { NEUTRAL_INPUT } from '../core/types';
import type {
  GameMap,
  InputState,
  InputsByPlayer,
  PlacedObject,
  PlayerState,
  World,
} from '../core/types';

/** Ticks de historia guardados (2 segundos). Mas que suficiente para el peor ping. */
const HISTORY = 120;

interface InputChange {
  tick: number;
  input: InputState;
}

/**
 * Simulacion con rollback.
 *
 * La idea, que es la que usan los juegos de pelea online:
 *
 *  1. Cada cliente simula a TODOS los jugadores, no solo al suyo.
 *  2. Por la red solo viajan los CAMBIOS de input, con el tick en que pasaron.
 *  3. Tu propio personaje responde al instante, sin esperar a nadie.
 *  4. De los demas se asume que siguen apretando lo mismo que la ultima vez.
 *  5. Cuando llega un input con un tick que ya pasó, se vuelve atras a ese
 *     tick y se re-simula hasta el presente con la informacion corregida.
 *
 * Como `step()` es determinista, todos los clientes llegan al mismo estado sin
 * que nadie mande posiciones. Eso hace que la red sea barata (unos pocos
 * mensajes por segundo y por jugador) y que no exista el caso de "cada uno ve
 * una carrera distinta".
 *
 * El costo es re-simular unos pocos ticks de vez en cuando, que con 4
 * personajes y una pantalla de 480x270 no se nota.
 */
export class RollbackSim {
  readonly world: World;
  /** Estado antes del ultimo tick simulado, para interpolar el render. */
  prev: PlayerState[];

  private readonly states = new Map<number, PlayerState[]>();
  private readonly changes = new Map<string, InputChange[]>();
  /** Tick mas viejo al que todavia se puede volver. */
  private oldest = 0;
  private rollbacks = 0;

  constructor(map: GameMap, ids: readonly string[], objects: readonly PlacedObject[] = []) {
    this.world = createWorld(map, ids, objects);
    this.prev = cloneWorldState(this.world);
    for (const id of ids) this.changes.set(id, []);
    this.states.set(0, cloneWorldState(this.world));
  }

  get tick(): number {
    return this.world.tick;
  }

  /** Cuantas veces hubo que rebobinar. Util para ver la salud de la conexion. */
  get rollbackCount(): number {
    return this.rollbacks;
  }

  /** Input vigente de un jugador en un tick dado. */
  private inputFor(id: string, tick: number): InputState {
    const list = this.changes.get(id);
    if (!list || list.length === 0) return NEUTRAL_INPUT;
    // Se recorre desde el final porque casi siempre interesa el ultimo.
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.tick <= tick) return list[i]!.input;
    }
    return NEUTRAL_INPUT;
  }

  /** Se reutiliza en cada tick: evita crear un objeto por paso de simulacion. */
  private readonly scratchInputs: Record<string, InputState> = {};

  private inputsAt(tick: number): InputsByPlayer {
    for (const key of Object.keys(this.scratchInputs)) delete this.scratchInputs[key];
    for (const p of this.world.players) this.scratchInputs[p.id] = this.inputFor(p.id, tick);
    return this.scratchInputs;
  }

  /**
   * Registra un cambio de input. Si llega tarde (su tick ya se simuló),
   * rebobina hasta ese tick y vuelve a avanzar.
   */
  applyInput(id: string, tick: number, input: InputState): void {
    const list = this.changes.get(id);
    if (!list) return;

    // Demasiado viejo para corregirlo: lo arreglara el proximo keyframe.
    const effective = Math.max(tick, this.oldest);

    // Insercion ordenada (normalmente al final).
    let i = list.length;
    while (i > 0 && list[i - 1]!.tick > effective) i--;
    if (i > 0 && list[i - 1]!.tick === effective) list[i - 1] = { tick: effective, input };
    else list.splice(i, 0, { tick: effective, input });

    if (effective < this.world.tick) this.rewindTo(effective);
  }

  private rewindTo(tick: number): void {
    const target = Math.max(tick, this.oldest);
    const saved = this.states.get(target);
    if (!saved) return;

    const resumeAt = this.world.tick;
    restoreWorldState(this.world, target, saved);
    this.rollbacks++;
    this.advanceTo(resumeAt);
  }

  /** Simula hasta el tick pedido. No retrocede: para eso esta el rollback. */
  advanceTo(target: number): void {
    while (this.world.tick < target) {
      // El estado previo ya esta guardado en la historia: reusarlo en vez de
      // volver a clonarlo ahorra una copia completa del mundo por tick.
      this.prev = this.states.get(this.world.tick) ?? cloneWorldState(this.world);
      step(this.world, this.inputsAt(this.world.tick));
      this.states.set(this.world.tick, cloneWorldState(this.world));
    }
    this.prune();
  }

  private prune(): void {
    const limit = this.world.tick - HISTORY;
    if (limit <= this.oldest) return;

    for (let t = this.oldest; t < limit; t++) this.states.delete(t);
    this.oldest = limit;

    // De cada jugador se conserva el ultimo cambio anterior al limite: es el
    // que define que esta apretando ahora.
    for (const list of this.changes.values()) {
      let keepFrom = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i]!.tick <= limit) keepFrom = i;
        else break;
      }
      if (keepFrom > 0) list.splice(0, keepFrom);
    }
  }

  /** Reemplaza el estado por el de un keyframe (entrada tardia o host nuevo). */
  applyKeyframe(tick: number, players: PlayerState[]): void {
    if (tick < this.world.tick - HISTORY) return;
    restoreWorldState(this.world, tick, players);
    this.states.clear();
    this.states.set(tick, cloneWorldState(this.world));
    this.oldest = tick;
    this.prev = cloneWorldState(this.world);
  }

  snapshot(): { tick: number; players: PlayerState[] } {
    return { tick: this.world.tick, players: cloneWorldState(this.world) };
  }
}
