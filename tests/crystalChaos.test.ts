import { describe, expect, it } from 'vitest';
import { PLAYER_H, PLAYER_W } from '../src/core/constants';
import { CRYSTAL_PLATFORMS, MAP_CRYSTAL_CHAOS } from '../src/core/maps/crystalChaos';
import { createWorld, everyoneDone, step } from '../src/core/simulation';
import type { Solid } from '../src/core/types';
import { P, input, solo } from './helpers';

/**
 * Verifica que CRYSTAL CHAOS sea jugable con la fisica actual - misma tecnica
 * que `course.test.ts` usa para ASCENSO: para cada salto del recorrido, prueba
 * TODOS los instantes de despegue posibles (0 a 60 ticks de demora) y exige
 * que al menos 3 den un aterrizaje limpio en la plataforma siguiente. Si el
 * mapa dejara de ser completable (o un salto quedara "pixel-perfect"), esto
 * lo dice antes que un jugador.
 *
 * Indices de CRYSTAL_PLATFORMS (ver core/maps/crystalChaos.ts):
 *   0 spawn · 1 L1 · 2 L2 · 3 FORK
 *   4 SAFE1 · 5 SAFE2 (ruta segura)         6 RISKY (ruta rapida)
 *   7 CH1 · 8 CH2 (one-way) · 9 CH3 (zona de caos)
 *   10 FINAL1 · 11 meseta de meta
 */

interface Hop {
  from: number;
  to: number;
  dir: 1 | -1;
}

/** Ruta principal (segura): la que se exige que funcione siempre. */
const MAIN_ROUTE: Hop[] = [
  { from: 0, to: 1, dir: 1 }, // spawn -> L1
  { from: 1, to: 2, dir: 1 }, // L1 -> L2
  { from: 2, to: 3, dir: 1 }, // L2 -> FORK
  { from: 3, to: 4, dir: -1 }, // FORK -> SAFE1
  { from: 4, to: 5, dir: -1 }, // SAFE1 -> SAFE2
  { from: 5, to: 7, dir: -1 }, // SAFE2 -> CH1 (entra a la zona de caos)
  { from: 7, to: 8, dir: 1 }, // CH1 -> CH2 (one-way)
  { from: 8, to: 9, dir: -1 }, // CH2 -> CH3
  { from: 9, to: 10, dir: 1 }, // CH3 -> FINAL1
  { from: 10, to: 11, dir: 1 }, // FINAL1 -> meseta de meta
];

/** Ruta rapida (opcional, mas riesgo): un solo salto largo desde el FORK. */
const FAST_ROUTE: Hop[] = [
  { from: 3, to: 6, dir: -1 }, // FORK -> RISKY
  { from: 6, to: 7, dir: -1 }, // RISKY -> CH1 (converge con la ruta segura)
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
  const from = CRYSTAL_PLATFORMS[hop.from]!;
  const to = CRYSTAL_PLATFORMS[hop.to]!;
  const startX = hop.dir > 0 ? from.x : from.x + from.w - PLAYER_W;

  let takeoffs = 0;
  for (let press = 0; press <= 60; press++) {
    const w = createWorld(MAP_CRYSTAL_CHAOS);
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

describe('mapa CRYSTAL CHAOS - dimensiones basicas', () => {
  it('respeta la resolucion virtual 480x270', () => {
    expect(MAP_CRYSTAL_CHAOS.width).toBe(480);
    expect(MAP_CRYSTAL_CHAOS.height).toBe(270);
  });

  it('tiene 4 spawns, uno por jugador, sin encimarse', () => {
    expect(MAP_CRYSTAL_CHAOS.spawns).toHaveLength(4);
    const xs = MAP_CRYSTAL_CHAOS.spawns.map((s) => s.x);
    expect(new Set(xs).size).toBe(4);
    // Separados al menos el ancho de un jugador, para que no arranquen pegados.
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(PLAYER_W);
    }
  });

  it('la plataforma de spawn es ancha (4 jugadores caben sin bloquearse)', () => {
    const spawnPlatform = CRYSTAL_PLATFORMS[0]!;
    expect(spawnPlatform.w).toBeGreaterThanOrEqual(100);
  });

  it('tiene pocos hazards (2), no spam', () => {
    expect(MAP_CRYSTAL_CHAOS.hazards.length).toBe(2);
  });

  it('la meta esta separada del spawn, no justo despues de un salto trivial', () => {
    const spawn = MAP_CRYSTAL_CHAOS.spawns[0]!;
    const dx = Math.abs(MAP_CRYSTAL_CHAOS.goal.x - spawn.x);
    const dy = Math.abs(MAP_CRYSTAL_CHAOS.goal.y - spawn.y);
    // Bien lejos en linea recta: no alcanza con un salto para llegar directo.
    expect(Math.hypot(dx, dy)).toBeGreaterThan(200);
  });

  it('ninguna plataforma de la ruta principal es tan angosta que un solo jugador la tape por completo', () => {
    // La ruta rapida (mas riesgosa) SI es angosta a proposito (indice 6).
    const mainRouteIndices = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11];
    for (const i of mainRouteIndices) {
      expect(CRYSTAL_PLATFORMS[i]!.w, `plataforma ${i}`).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('mapa CRYSTAL CHAOS - ruta principal (segura) completable', () => {
  for (const hop of MAIN_ROUTE) {
    it(`salto ${hop.from} -> ${hop.to} es posible, sin ser pixel-perfect`, () => {
      const r = attempt(hop);
      expect(r.ok, `ningun despegue llega de la plataforma ${hop.from} a la ${hop.to}`).toBe(true);
      expect(r.takeoffs).toBeGreaterThanOrEqual(3);
    });
  }

  it('la meta es alcanzable caminando desde la meseta final', () => {
    const meseta = CRYSTAL_PLATFORMS[11]!;
    const w = createWorld(MAP_CRYSTAL_CHAOS);
    P(w).x = meseta.x;
    P(w).y = meseta.y - PLAYER_H;
    for (let t = 0; t < 200; t++) {
      step(w, solo(input({ right: true })));
      if (P(w).phase === 'finished') break;
    }
    expect(P(w).phase).toBe('finished');
  });

  it('recorrido completo: desde el spawn se puede llegar a la meta encadenando los saltos de la ruta segura', () => {
    // No busca timing optimo: reusa una ventana de despegue que ya funciono
    // para cada salto (probado arriba) y los encadena en un unico mundo, como
    // jugaria una persona real de punta a punta.
    const w = createWorld(MAP_CRYSTAL_CHAOS);

    function hop(from: Solid, dir: 1 | -1, holdTicks: number, settleTicks: number): void {
      const startX = dir > 0 ? P(w).x : P(w).x; // continua desde donde esta
      void from;
      void startX;
      for (let i = 0; i < holdTicks; i++) {
        step(w, solo(input({ left: dir < 0, right: dir > 0, jump: i < 22 })));
      }
      let i = 0;
      while (i++ < settleTicks && !P(w).onGround) {
        step(w, solo(input({ left: dir < 0, right: dir > 0 })));
      }
    }

    // spawn -> L1 -> L2 -> FORK: corridas llanas con salto sostenido.
    for (let i = 0; i < 40; i++) step(w, solo(input({ right: true }))); // acelera en el spawn
    hop(CRYSTAL_PLATFORMS[0]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ right: true })));
    hop(CRYSTAL_PLATFORMS[1]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ right: true })));
    hop(CRYSTAL_PLATFORMS[2]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true); // llego al FORK

    // FORK -> SAFE1 -> SAFE2 -> CH1: ruta segura, hacia la izquierda.
    for (let i = 0; i < 30; i++) step(w, solo(input({ left: true })));
    hop(CRYSTAL_PLATFORMS[3]!, -1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ left: true })));
    hop(CRYSTAL_PLATFORMS[4]!, -1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ left: true })));
    hop(CRYSTAL_PLATFORMS[5]!, -1, 30, 60);
    expect(P(w).onGround).toBe(true); // entro a la zona de caos (CH1)

    // CH1 -> CH2 (one-way) -> CH3: dentro de la zona de caos.
    for (let i = 0; i < 30; i++) step(w, solo(input({ right: true })));
    hop(CRYSTAL_PLATFORMS[7]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ left: true })));
    hop(CRYSTAL_PLATFORMS[8]!, -1, 30, 60);
    expect(P(w).onGround).toBe(true);

    // CH3 -> FINAL1 -> meseta de meta: tramo final.
    for (let i = 0; i < 30; i++) step(w, solo(input({ right: true })));
    hop(CRYSTAL_PLATFORMS[9]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true);

    for (let i = 0; i < 30; i++) step(w, solo(input({ right: true })));
    hop(CRYSTAL_PLATFORMS[10]!, 1, 30, 60);
    expect(P(w).onGround).toBe(true); // llego a la meseta de meta

    // Camina sobre la meseta hasta tocar la meta.
    for (let t = 0; t < 200 && P(w).phase === 'racing'; t++) {
      step(w, solo(input({ right: true })));
    }
    expect(P(w).phase).toBe('finished');
  });
});

describe('mapa CRYSTAL CHAOS - ruta rapida (riesgosa), tambien posible', () => {
  for (const hop of FAST_ROUTE) {
    it(`salto ${hop.from} -> ${hop.to} es posible (mas dificil que la ruta segura)`, () => {
      const r = attempt(hop);
      expect(r.ok, `ningun despegue llega de la plataforma ${hop.from} a la ${hop.to}`).toBe(true);
    });
  }

  it('la ventana de despegue de la ruta rapida es mas angosta que la de la ruta segura', () => {
    // No es un requisito estricto, pero confirma que "rapida" tambien es
    // realmente "mas arriesgada": menos margen de error que un tramo comodo.
    const risky = attempt({ from: 3, to: 6, dir: -1 });
    const safe = attempt({ from: 3, to: 4, dir: -1 });
    expect(risky.takeoffs).toBeLessThan(safe.takeoffs);
  });
});

describe('mapa CRYSTAL CHAOS - multiplayer basico', () => {
  it('4 jugadores pueden spawnear y simular sin errores ni duplicados', () => {
    const w = createWorld(MAP_CRYSTAL_CHAOS, ['a', 'b', 'c', 'd']);
    expect(w.players).toHaveLength(4);
    expect(new Set(w.players.map((p) => p.id)).size).toBe(4);
    for (let i = 0; i < 60; i++) {
      step(w, {
        a: input({ right: true }),
        b: input({ right: true, jump: i < 20 }),
        c: input(),
        d: input({ left: true }),
      });
    }
    expect(w.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('una ronda con varios jugadores puede terminar (todos dejan de correr)', () => {
    const w = createWorld(MAP_CRYSTAL_CHAOS, ['a', 'b', 'c', 'd']);
    w.players[0]!.phase = 'finished';
    w.players[0]!.endTick = 5;
    w.players[1]!.phase = 'dead';
    w.players[1]!.endTick = 6;
    w.players[2]!.phase = 'dead';
    w.players[2]!.endTick = 7;
    w.players[3]!.phase = 'finished';
    w.players[3]!.endTick = 8;
    expect(everyoneDone(w)).toBe(true);
  });
});
