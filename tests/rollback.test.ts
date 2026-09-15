import { describe, expect, it } from 'vitest';
import { MAP_ASCENSO } from '../src/core/maps/ascenso';
import { RollbackSim } from '../src/net/RollbackSim';
import type { InputState } from '../src/core/types';
import { input } from './helpers';

const IDS = ['a', 'b', 'c'];

interface Change {
  id: string;
  tick: number;
  input: InputState;
}

/** Guion reproducible de cambios de input de tres jugadores. */
function script(): Change[] {
  let seed = 4242;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: Change[] = [];
  for (let tick = 1; tick < 240; tick++) {
    for (const id of IDS) {
      if (rand() < 0.12) {
        out.push({
          id,
          tick,
          input: input({ left: rand() < 0.3, right: rand() < 0.6, jump: rand() < 0.35 }),
        });
      }
    }
  }
  return out;
}

function stateOf(sim: RollbackSim): string {
  return JSON.stringify(sim.world.players);
}

describe('RollbackSim', () => {
  it('simula a todos los jugadores de forma determinista', () => {
    const a = new RollbackSim(MAP_ASCENSO, IDS);
    const b = new RollbackSim(MAP_ASCENSO, IDS);
    for (const c of script()) {
      a.applyInput(c.id, c.tick, c.input);
      b.applyInput(c.id, c.tick, c.input);
    }
    a.advanceTo(300);
    b.advanceTo(300);
    expect(stateOf(b)).toBe(stateOf(a));
  });

  it('un input que llega tarde da el mismo resultado que si hubiera llegado a tiempo', () => {
    const changes = script();

    // Cliente ideal: cada input se aplica justo en su tick.
    const ideal = new RollbackSim(MAP_ASCENSO, IDS);
    for (let tick = 0; tick <= 300; tick++) {
      for (const c of changes) {
        if (c.tick === tick) ideal.applyInput(c.id, c.tick, c.input);
      }
      ideal.advanceTo(tick);
    }

    // Cliente real: cada input llega entre 3 y 12 ticks tarde, o sea que su
    // tick ya fue simulado y hay que rebobinar.
    const laggy = new RollbackSim(MAP_ASCENSO, IDS);
    for (let tick = 0; tick <= 300; tick++) {
      for (const c of changes) {
        const delay = 3 + ((c.tick * 7) % 10);
        if (c.tick + delay === tick) laggy.applyInput(c.id, c.tick, c.input);
      }
      laggy.advanceTo(tick);
    }

    expect(laggy.rollbackCount).toBeGreaterThan(0);
    expect(stateOf(laggy)).toBe(stateOf(ideal));
  });

  it('el orden de llegada de los mensajes no cambia el resultado', () => {
    const changes = script();
    const inOrder = new RollbackSim(MAP_ASCENSO, IDS);
    for (const c of changes) inOrder.applyInput(c.id, c.tick, c.input);
    inOrder.advanceTo(300);

    // Mismo lote, pero al reves y con la simulacion ya arrancada: todo lo que
    // quede por detras obliga a rebobinar.
    const shuffled = new RollbackSim(MAP_ASCENSO, IDS);
    shuffled.advanceTo(30);
    for (const c of [...changes].reverse()) shuffled.applyInput(c.id, c.tick, c.input);
    shuffled.advanceTo(300);

    expect(shuffled.rollbackCount).toBeGreaterThan(0);

    expect(stateOf(shuffled)).toBe(stateOf(inOrder));
  });

  it('no retrocede mas alla de la historia que guarda', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(400);
    const before = sim.tick;
    // Un input absurdamente viejo no debe romper nada ni rebobinar 400 ticks.
    sim.applyInput('a', 1, input({ right: true }));
    expect(sim.tick).toBe(before);
  });

  it('un keyframe reemplaza el estado y se sigue desde ahi', () => {
    const source = new RollbackSim(MAP_ASCENSO, IDS);
    source.applyInput('a', 5, input({ right: true, jump: true }));
    source.advanceTo(90);
    const key = source.snapshot();

    const joiner = new RollbackSim(MAP_ASCENSO, IDS);
    joiner.applyKeyframe(key.tick, key.players);
    expect(joiner.tick).toBe(key.tick);
    expect(stateOf(joiner)).toBe(JSON.stringify(key.players));

    // Y desde el keyframe ambos siguen igual con los mismos inputs.
    source.advanceTo(150);
    joiner.applyInput('a', 5, input({ right: true, jump: true }));
    joiner.advanceTo(150);
    expect(stateOf(joiner)).toBe(stateOf(source));
  });

  it('el estado previo sirve para interpolar el render', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.applyInput('a', 0, input({ right: true }));
    sim.advanceTo(30);
    expect(sim.prev.length).toBe(IDS.length);
    expect(sim.prev[0]!.x).not.toBe(sim.world.players[0]!.x);
  });
});

/**
 * Eliminacion "fuera de banda" (rendirse, desconexion).
 *
 * A diferencia de un input, esto no pasa por el historial de replay normal:
 * es una mutacion directa que tiene que sobrevivir a un rollback aunque el
 * rollback rebobine a un momento anterior a la eliminacion.
 */
describe('eliminate (rendirse / desconexion)', () => {
  it('elimina de inmediato a un jugador que sigue corriendo', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(50);
    sim.eliminate('b', sim.tick);

    const b = sim.world.players.find((p) => p.id === 'b')!;
    expect(b.phase).toBe('dead');
    expect(b.endTick).toBe(50);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('un input tardio de OTRO jugador no resucita al eliminado (el bug que se corrigio)', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(80);
    sim.eliminate('b', 80);
    expect(sim.world.players.find((p) => p.id === 'b')!.phase).toBe('dead');

    // Llega un input de 'a' con un tick anterior a la eliminacion de 'b':
    // esto dispara un rewindTo por debajo del tick 80 y vuelve a avanzar.
    sim.applyInput('a', 20, input({ right: true }));
    expect(sim.rollbackCount).toBeGreaterThan(0);

    // 'b' tiene que seguir eliminado despues del rebobinado, no volver a 'racing'.
    const b = sim.world.players.find((p) => p.id === 'b')!;
    expect(b.phase).toBe('dead');
    expect(b.endTick).toBe(80);
  });

  it('un input del propio eliminado, aunque llegue despues, no lo hace moverse', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(60);
    sim.eliminate('c', 60);
    const frozenX = sim.world.players.find((p) => p.id === 'c')!.x;

    // Le sigue llegando un input suyo (por ejemplo, el ultimo que solto antes
    // de irse) para un tick posterior a su eliminacion: no debe moverlo,
    // porque un jugador 'dead' ni siquiera lee su input en cada step.
    sim.applyInput('c', sim.tick + 5, input({ right: true }));
    sim.advanceTo(120);

    const c = sim.world.players.find((p) => p.id === 'c')!;
    expect(c.phase).toBe('dead');
    expect(c.endTick).toBe(60);
    expect(c.x).toBe(frozenX);
  });

  it('programada para un tick futuro, se aplica recien cuando la simulacion llega ahi', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.eliminate('a', 100);
    sim.advanceTo(50);
    expect(sim.world.players.find((p) => p.id === 'a')!.phase).toBe('racing');

    sim.advanceTo(100);
    expect(sim.world.players.find((p) => p.id === 'a')!.phase).toBe('dead');
  });

  it('es idempotente: la primera eliminacion registrada gana', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(40);
    sim.eliminate('a', 40);
    sim.eliminate('a', 999); // llega despues, por ejemplo un 'left' duplicado
    expect(sim.world.players.find((p) => p.id === 'a')!.endTick).toBe(40);
  });

  it('no revive a nadie ni duplica jugadores al aplicar un keyframe', () => {
    const sim = new RollbackSim(MAP_ASCENSO, IDS);
    sim.advanceTo(70);
    sim.eliminate('b', 70);
    const before = sim.world.players.length;

    // Keyframe de otro cliente que, por lo que sea, todavia tiene a 'b' vivo.
    const stale = sim
      .snapshot()
      .players.map((p) => (p.id === 'b' ? { ...p, phase: 'racing' as const, endTick: -1 } : p));
    sim.applyKeyframe(70, stale);

    expect(sim.world.players.length).toBe(before);
    expect(sim.world.players.find((p) => p.id === 'b')!.phase).toBe('dead');
  });
});
