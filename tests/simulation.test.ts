import { describe, expect, it } from 'vitest';
import { COYOTE_TICKS, JUMP_SPEED, MAX_FALL, PLAYER_H, TICK_RATE } from '../src/core/constants';
import { MAP_ASCENSO } from '../src/core/maps/ascenso';
import { createWorld, everyoneDone, resetWorld, step } from '../src/core/simulation';
import { P, input, minY, run, runUntil, solo } from './helpers';

const GROUND_Y = 252 - PLAYER_H; // apoyado sobre la plataforma de salida

describe('estado inicial', () => {
  it('aparece apoyado en la salida', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input(), 10);
    expect(w.players[0]!.y).toBe(GROUND_Y);
    expect(w.players[0]!.onGround).toBe(true);
    expect(w.players[0]!.phase).toBe('racing');
  });

  it('resetWorld vuelve exactamente al estado inicial', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input({ right: true, jump: true }), 40);
    resetWorld(w);
    expect(w.tick).toBe(0);
    expect(w.players[0]!.x).toBe(MAP_ASCENSO.spawns[0]!.x);
    expect(w.players[0]!.y).toBe(MAP_ASCENSO.spawns[0]!.y);
    expect(w.players[0]!.vx).toBe(0);
    expect(w.players[0]!.phase).toBe('racing');
  });
});

describe('gravedad y caida', () => {
  it('respeta la velocidad terminal', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 130; // sobre el hueco
    w.players[0]!.y = 0;
    run(w, input(), 20);
    expect(w.players[0]!.vy).toBe(MAX_FALL);
  });

  it('muere al caer fuera del mapa', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 130;
    w.players[0]!.y = 0;
    const ticks = runUntil(w, input(), (x) => x.players[0]!.phase === 'dead');
    expect(ticks).toBeGreaterThan(0);
    expect(w.players[0]!.phase).toBe('dead');
    expect(w.players[0]!.endTick).toBe(ticks);
  });
});

describe('salto', () => {
  it('alcanza entre 40 y 55 px de altura manteniendo el boton', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input(), 5);
    const top = minY(w, input({ jump: true }), 60);
    const height = GROUND_Y - top;
    expect(height).toBeGreaterThanOrEqual(40);
    expect(height).toBeLessThanOrEqual(55);
  });

  it('el salto corto es claramente mas bajo que el largo', () => {
    const full = createWorld(MAP_ASCENSO);
    run(full, input(), 5);
    const fullTop = minY(full, input({ jump: true }), 60);

    const short = createWorld(MAP_ASCENSO);
    run(short, input(), 5);
    const shortTop = Math.min(
      minY(short, input({ jump: true }), 4),
      minY(short, input(), 56),
    );

    expect(shortTop).toBeGreaterThan(fullTop + 8);
    expect(GROUND_Y - shortTop).toBeGreaterThan(8);
  });

  it('mantener el boton no encadena saltos automaticos', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input(), 5);
    run(w, input({ jump: true }), 120);
    expect(w.players[0]!.onGround).toBe(true);
    expect(w.players[0]!.y).toBe(GROUND_Y);
  });

  it('coyote time permite saltar despues de dejar la plataforma', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 112;
    run(w, input(), 2);
    const ticks = runUntil(w, input({ right: true }), (x) => !x.players[0]!.onGround, 120);
    expect(ticks).toBeGreaterThan(0);
    expect(w.players[0]!.coyote).toBeGreaterThan(0);
    expect(w.players[0]!.coyote).toBeLessThanOrEqual(COYOTE_TICKS);

    step(w, solo(input({ right: true, jump: true })));
    expect(w.players[0]!.vy).toBeLessThan(0);
  });

  it('jump buffer dispara el salto apenas toca el suelo', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 40;
    w.players[0]!.y = GROUND_Y - 2;
    w.players[0]!.vy = 60;
    w.players[0]!.onGround = false;
    w.players[0]!.coyote = 0;

    run(w, input({ jump: true }), 6);
    expect(w.players[0]!.vy).toBeLessThan(0);
    expect(w.players[0]!.y).toBeLessThan(GROUND_Y - 4);
  });
});

describe('impulsos externos', () => {
  it('un empujon externo no se recorta al soltar el salto', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input(), 5);
    w.players[0]!.vy = -JUMP_SPEED;
    w.players[0]!.onGround = false;
    w.players[0]!.jumping = false;
    const top = minY(w, input(), 40);
    expect(GROUND_Y - top).toBeGreaterThanOrEqual(40);
  });
});

describe('plataformas one-way', () => {
  it('se atraviesan subiendo y frenan al caer', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 350;
    w.players[0]!.y = 176;
    w.players[0]!.vy = -JUMP_SPEED;
    w.players[0]!.onGround = false;
    w.players[0]!.coyote = 0;

    // Sube: debe pasar de largo la plataforma one-way de y=158.
    run(w, input(), 20);
    expect(w.players[0]!.y + PLAYER_H).toBeLessThan(158);

    // Cae: ahora si tiene que apoyar encima.
    runUntil(w, input(), (x) => x.players[0]!.onGround, 120);
    expect(w.players[0]!.onGround).toBe(true);
    expect(w.players[0]!.y).toBe(158 - PLAYER_H);
  });
});

describe('peligros y meta', () => {
  it('los pinches matan', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 218;
    w.players[0]!.y = 200;
    runUntil(w, input(), (x) => x.players[0]!.phase !== 'racing', 120);
    expect(w.players[0]!.phase).toBe('dead');
  });

  it('tocar la meta termina la carrera', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 408;
    w.players[0]!.y = 24;
    step(w, solo(input()));
    expect(w.players[0]!.phase).toBe('finished');
    expect(w.players[0]!.endTick).toBe(1);
  });

  it('muerto o en meta el personaje queda congelado', () => {
    const w = createWorld(MAP_ASCENSO);
    w.players[0]!.x = 408;
    w.players[0]!.y = 24;
    step(w, solo(input()));
    const { x, y } = P(w);
    run(w, input({ right: true, jump: true }), 60);
    expect(w.players[0]!.x).toBe(x);
    expect(w.players[0]!.y).toBe(y);
  });
});

describe('limites del mapa', () => {
  it('no se sale por el costado izquierdo', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input({ left: true }), 200);
    expect(w.players[0]!.x).toBe(0);
    expect(w.players[0]!.phase).toBe('racing');
  });
});

describe('determinismo', () => {
  it('la misma secuencia de inputs produce exactamente el mismo estado', () => {
    const sequence = buildSequence(900);

    const a = createWorld(MAP_ASCENSO);
    const b = createWorld(MAP_ASCENSO);
    for (const inp of sequence) step(a, solo(inp));
    for (const inp of sequence) step(b, solo(inp));

    expect(JSON.stringify(b.players[0]!)).toBe(JSON.stringify(a.players[0]!));
    expect(b.tick).toBe(a.tick);
  });

  it('un segundo de simulacion son exactamente TICK_RATE ticks', () => {
    const w = createWorld(MAP_ASCENSO);
    run(w, input(), TICK_RATE);
    expect(w.tick).toBe(TICK_RATE);
  });
});

/** Secuencia pseudoaleatoria pero reproducible de inputs. */
function buildSequence(length: number) {
  let seed = 98765;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out = [];
  for (let i = 0; i < length; i++) {
    out.push(input({ left: rand() < 0.3, right: rand() < 0.5, jump: rand() < 0.25 }));
  }
  return out;
}

describe('fin de ronda', () => {
  it('everyoneDone detecta cuando ya no queda nadie corriendo', () => {
    const w = createWorld(MAP_ASCENSO, ['a', 'b']);
    expect(everyoneDone(w)).toBe(false);

    w.players[0]!.phase = 'finished';
    expect(everyoneDone(w)).toBe(false);

    w.players[1]!.phase = 'dead';
    expect(everyoneDone(w)).toBe(true);
  });

  it('cada jugador arranca en su propia posicion de salida', () => {
    const w = createWorld(MAP_ASCENSO, ['a', 'b', 'c', 'd']);
    const xs = w.players.map((p) => p.x);
    expect(new Set(xs).size).toBe(4);
  });

  it('los jugadores no se estorban entre si: no colisionan', () => {
    const w = createWorld(MAP_ASCENSO, ['a', 'b']);
    w.players[1]!.x = w.players[0]!.x;
    for (let i = 0; i < 30; i++) {
      step(w, { a: input({ right: true }), b: input({ right: true }) });
    }
    expect(w.players[0]!.x).toBeCloseTo(w.players[1]!.x, 5);
  });
});
