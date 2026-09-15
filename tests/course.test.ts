import { describe, expect, it } from 'vitest';
import { PLAYER_H, PLAYER_W } from '../src/core/constants';
import { MAP_ASCENSO, PLATFORMS } from '../src/core/maps/ascenso';
import { createWorld, step } from '../src/core/simulation';
import type { Solid } from '../src/core/types';
import { P, input, solo } from './helpers';

/**
 * Verifica que el circuito sea jugable con la fisica actual.
 *
 * Para cada salto del recorrido prueba todos los momentos de despegue posibles
 * y exige que al menos uno aterrice en la plataforma siguiente. Si manana
 * alguien toca la gravedad o la velocidad de salto y el mapa deja de ser
 * completable, este test lo dice antes que un jugador.
 */

interface Hop {
  from: number;
  to: number;
  dir: 1 | -1;
}

const HOPS: Hop[] = [
  { from: 0, to: 1, dir: 1 },
  { from: 1, to: 2, dir: 1 },
  { from: 2, to: 3, dir: 1 },
  { from: 3, to: 4, dir: 1 },
  { from: 4, to: 5, dir: -1 },
  { from: 5, to: 6, dir: -1 },
  { from: 6, to: 7, dir: -1 },
  { from: 7, to: 8, dir: -1 },
  { from: 8, to: 9, dir: 1 },
  { from: 9, to: 10, dir: 1 },
  { from: 10, to: 11, dir: 1 },
];

function landedOn(x: number, y: number, target: Solid): boolean {
  return (
    Math.abs(y - (target.y - PLAYER_H)) < 0.001 &&
    x + PLAYER_W > target.x &&
    x < target.x + target.w
  );
}

/** Intenta el salto con cada instante de despegue; devuelve el margen de exito. */
function attempt(hop: Hop): { ok: boolean; takeoffs: number } {
  const from = PLATFORMS[hop.from]!;
  const to = PLATFORMS[hop.to]!;
  // Arranca en el extremo opuesto al objetivo para tener carrera completa.
  const startX = hop.dir > 0 ? from.x : from.x + from.w - PLAYER_W;

  let takeoffs = 0;
  for (let press = 0; press <= 60; press++) {
    const w = createWorld(MAP_ASCENSO);
    P(w).x = startX;
    P(w).y = from.y - PLAYER_H;
    const move = input(hop.dir > 0 ? { right: true } : { left: true });
    const moveJump = input(
      hop.dir > 0 ? { right: true, jump: true } : { left: true, jump: true },
    );

    let ok = false;
    for (let t = 0; t < 200; t++) {
      step(w, solo(t >= press ? moveJump : move));
      if (P(w).phase !== 'racing') break;
      if (t > press && P(w).onGround && landedOn(P(w).x, P(w).y, to)) {
        ok = true;
        break;
      }
    }
    if (ok) takeoffs++;
  }
  return { ok: takeoffs > 0, takeoffs };
}

describe('circuito ASCENSO', () => {
  for (const hop of HOPS) {
    it(`el salto ${hop.from + 1} -> ${hop.to + 1} es posible`, () => {
      const r = attempt(hop);
      expect(r.ok, `ningun despegue llega de la plataforma ${hop.from + 1} a la ${hop.to + 1}`).toBe(
        true,
      );
      // Si solo funciona con 1 o 2 timings exactos, el salto es frustrante.
      expect(r.takeoffs).toBeGreaterThanOrEqual(3);
    });
  }

  it('la meta es alcanzable desde la ultima plataforma', () => {
    const last = PLATFORMS[11]!;
    const w = createWorld(MAP_ASCENSO);
    P(w).x = last.x;
    P(w).y = last.y - PLAYER_H;
    for (let t = 0; t < 200; t++) {
      step(w, solo(input({ right: true })));
      if (P(w).phase === 'finished') break;
    }
    expect(P(w).phase).toBe('finished');
  });
});
