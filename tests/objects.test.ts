import { describe, expect, it } from 'vitest';
import { PLAYER_H, TICK_RATE } from '../src/core/constants';
import { MAP_ASCENSO } from '../src/core/map';
import { generateOffers, makeRandom, offerCount } from '../src/core/chaosbox';
import { OBJECT_TYPES, objectSize, objectType, objectsToGeometry } from '../src/core/objects/catalog';
import { PLACE_GRID, checkPlacement, snap, snapPlacement } from '../src/core/objects/placement';
import { createWorld, step } from '../src/core/simulation';
import type { PlacedObject } from '../src/core/types';
import { input } from './helpers';

const place = (over: Partial<PlacedObject> = {}): PlacedObject => ({
  id: 'o1',
  type: 'tabla',
  ownerId: 'a',
  x: 200,
  y: 120,
  rotation: 0,
  ...over,
});

describe('catalogo', () => {
  it('todos los objetos tienen forma y categoria', () => {
    for (const t of OBJECT_TYPES) {
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
      expect(t.parts.length).toBeGreaterThan(0);
      expect(t.category).toBeTruthy();
    }
  });

  it('hay objetos de todas las categorias', () => {
    const categories = new Set(OBJECT_TYPES.map((t) => t.category));
    expect(categories.size).toBeGreaterThanOrEqual(5);
  });

  it('girar un objeto intercambia ancho y alto', () => {
    const columna = objectType('columna')!;
    expect(objectSize(columna, 0)).toEqual({ w: columna.w, h: columna.h });
    expect(objectSize(columna, 1)).toEqual({ w: columna.h, h: columna.w });
  });

  it('lo que no se puede girar no cambia de tamano', () => {
    const bloque = objectType('bloque')!;
    expect(objectSize(bloque, 1)).toEqual(objectSize(bloque, 0));
  });

  it('un peligro recuerda de quien es la trampa', () => {
    const { hazards } = objectsToGeometry([place({ type: 'pinchos', ownerId: 'ana' })]);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]!.ownerId).toBe('ana');
  });
});

describe('chaos box', () => {
  it('ofrece jugadores + 2 objetos', () => {
    expect(offerCount(2)).toBe(4);
    expect(offerCount(3)).toBe(5);
    expect(offerCount(4)).toBe(6);
  });

  it('la misma semilla da exactamente la misma oferta en todos los clientes', () => {
    const a = generateOffers(12345, 6);
    const b = generateOffers(12345, 6);
    expect(b).toEqual(a);
  });

  it('semillas distintas dan ofertas distintas', () => {
    const a = generateOffers(1, 6).map((o) => o.type);
    const b = generateOffers(2, 6).map((o) => o.type);
    expect(b).not.toEqual(a);
  });

  it('nunca ofrece solo trampas ni solo plataformas', () => {
    for (let seed = 0; seed < 40; seed++) {
      const types = generateOffers(seed, 4).map((o) => objectType(o.type)!);
      const categories = new Set(types.map((t) => t.category));
      expect(categories.size).toBeGreaterThanOrEqual(2);
      expect(types.some((t) => t.category === 'plataforma')).toBe(true);
      // Como maximo dos de la misma categoria.
      for (const c of categories) {
        expect(types.filter((t) => t.category === c).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('el generador es estable y reproducible', () => {
    const r1 = makeRandom(7);
    const r2 = makeRandom(7);
    for (let i = 0; i < 20; i++) expect(r2()).toBe(r1());
  });
});

describe('colocacion', () => {
  it('la grilla redondea a multiplos de 8', () => {
    expect(snap(11)).toBe(8);
    expect(snap(13)).toBe(16);
  });

  it('acepta un hueco libre', () => {
    expect(checkPlacement(place({ x: 200, y: 160 }), MAP_ASCENSO, []).valid).toBe(true);
  });

  it('rechaza fuera del mapa', () => {
    expect(checkPlacement(place({ x: 470, y: 160 }), MAP_ASCENSO, []).error).toBe('FUERA_DEL_MAPA');
    expect(checkPlacement(place({ x: 100, y: -4 }), MAP_ASCENSO, []).error).toBe('FUERA_DEL_MAPA');
  });

  it('rechaza encima del terreno', () => {
    // Sobre el repecho derecho (lejos de la salida y de la meta).
    expect(checkPlacement(place({ x: 420, y: 190 }), MAP_ASCENSO, []).error).toBe(
      'SOBRE_EL_TERRENO',
    );
  });

  it('rechaza encima de otro objeto', () => {
    const existing = [place({ id: 'o0', x: 200, y: 160 })];
    const check = checkPlacement(place({ id: 'o1', x: 204, y: 160 }), MAP_ASCENSO, existing);
    expect(check.error).toBe('SOBRE_OTRO_OBJETO');
  });

  it('nadie puede tapar la meta', () => {
    const check = checkPlacement(
      place({ type: 'viga', x: MAP_ASCENSO.goal.x - 20, y: MAP_ASCENSO.goal.y }),
      MAP_ASCENSO,
      [],
    );
    expect(check.error).toBe('ZONA_PROTEGIDA');
  });

  it('nadie puede encerrar la salida', () => {
    const spawn = MAP_ASCENSO.spawns[0]!;
    const check = checkPlacement(place({ x: spawn.x, y: spawn.y - 4 }), MAP_ASCENSO, []);
    expect(check.error).toBe('ZONA_PROTEGIDA');
  });
});

describe('objetos en la simulacion', () => {
  it('una tabla colocada sostiene al jugador', () => {
    const tabla = place({ type: 'tabla', x: 130, y: 220 });
    const w = createWorld(MAP_ASCENSO, ['a'], [tabla]);
    w.players[0]!.x = 136;
    w.players[0]!.y = 180;
    for (let i = 0; i < 60; i++) step(w, { a: input() });
    expect(w.players[0]!.onGround).toBe(true);
    expect(w.players[0]!.y).toBe(220 - PLAYER_H);
  });

  it('los pinchos de otro jugador matan y quedan atribuidos', () => {
    const trampa = place({ type: 'pinchos', ownerId: 'beto', x: 130, y: 220 });
    const w = createWorld(MAP_ASCENSO, ['a'], [trampa]);
    w.players[0]!.x = 134;
    w.players[0]!.y = 180;
    for (let i = 0; i < 60 && w.players[0]!.phase === 'racing'; i++) step(w, { a: input() });
    expect(w.players[0]!.phase).toBe('dead');
    expect(w.players[0]!.killedBy).toBe('beto');
  });

  it('la propia trampa no da puntos: no se atribuye a su dueno', () => {
    const trampa = place({ type: 'pinchos', ownerId: 'a', x: 130, y: 220 });
    const w = createWorld(MAP_ASCENSO, ['a'], [trampa]);
    w.players[0]!.x = 134;
    w.players[0]!.y = 180;
    for (let i = 0; i < 60 && w.players[0]!.phase === 'racing'; i++) step(w, { a: input() });
    expect(w.players[0]!.phase).toBe('dead');
    expect(w.players[0]!.killedBy).toBe(null);
  });

  it('caerse del mapa no se le atribuye a nadie', () => {
    const w = createWorld(MAP_ASCENSO, ['a'], []);
    w.players[0]!.x = 130;
    w.players[0]!.y = 0;
    for (let i = 0; i < 120 && w.players[0]!.phase === 'racing'; i++) step(w, { a: input() });
    expect(w.players[0]!.phase).toBe('dead');
    expect(w.players[0]!.killedBy).toBe(null);
  });

  it('el resorte lanza mas alto que un salto normal', () => {
    const resorte = place({ type: 'resorte', x: 130, y: 220 });
    const w = createWorld(MAP_ASCENSO, ['a'], [resorte]);
    w.players[0]!.x = 134;
    w.players[0]!.y = 180;
    let top = w.players[0]!.y;
    for (let i = 0; i < 120; i++) {
      step(w, { a: input() });
      top = Math.min(top, w.players[0]!.y);
    }
    // Rebota bastante por encima de la altura de salto (46 px).
    expect(220 - PLAYER_H - top).toBeGreaterThan(55);
  });

  it('en el hielo se sigue de largo y en la brea se frena en seco', () => {
    // Se mide sobre la propia superficie: se lanza al jugador y se suelta todo.
    const slideSpeed = (type: string): number => {
      const suelo = place({ type, x: 100, y: 200 });
      const w = createWorld(MAP_ASCENSO, ['a'], [suelo]);
      w.players[0]!.x = 108;
      w.players[0]!.y = 200 - PLAYER_H;
      step(w, { a: input() }); // apoya y toma el agarre del suelo
      expect(w.players[0]!.onGround).toBe(true);
      w.players[0]!.vx = 100;
      for (let i = 0; i < 6; i++) step(w, { a: input() });
      return Math.abs(w.players[0]!.vx);
    };

    const hielo = slideSpeed('hielo');
    const brea = slideSpeed('brea');
    expect(hielo).toBeGreaterThan(80); // casi no frena
    expect(brea).toBe(0); // se clava
    expect(hielo).toBeGreaterThan(brea);
  });

  it('el suelo normal queda justo entre el hielo y la brea', () => {
    // Mismo lanzamiento en las tres superficies, medido a los 3 ticks.
    const speedAfter = (objects: PlacedObject[], x: number): number => {
      const w = createWorld(MAP_ASCENSO, ['a'], objects);
      w.players[0]!.x = x;
      w.players[0]!.y = (objects[0] ? 200 : 252) - PLAYER_H;
      step(w, { a: input() });
      w.players[0]!.vx = 100;
      for (let i = 0; i < 3; i++) step(w, { a: input() });
      return Math.abs(w.players[0]!.vx);
    };

    const hielo = speedAfter([place({ type: 'hielo', x: 100, y: 200 })], 108);
    const normal = speedAfter([], 40);
    const brea = speedAfter([place({ type: 'brea', x: 100, y: 200 })], 108);

    expect(hielo).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(brea);
    expect(brea).toBe(0);
  });

  it('la simulacion con objetos sigue siendo determinista', () => {
    const objects = [
      place({ id: 'o1', type: 'tabla', x: 130, y: 220 }),
      place({ id: 'o2', type: 'resorte', x: 220, y: 170 }),
      place({ id: 'o3', type: 'pinchos', ownerId: 'b', x: 300, y: 180 }),
    ];
    const run = (): string => {
      const w = createWorld(MAP_ASCENSO, ['a', 'b'], objects);
      for (let i = 0; i < TICK_RATE * 3; i++) {
        step(w, { a: input({ right: true, jump: i % 20 < 6 }), b: input({ right: i % 30 < 15 }) });
      }
      return JSON.stringify(w.players);
    };
    expect(run()).toBe(run());
  });
});

describe('iman de colocacion', () => {
  it('apoya los pinchos justo encima de una plataforma aunque no caiga en la grilla', () => {
    // Plataforma 2 del mapa: arriba en y=226, que no es multiplo de 4 ni de 8.
    const pos = snapPlacement('pinchos', 0, 180, 219, MAP_ASCENSO, []);
    expect(pos.y + 6).toBe(226);
    const check = checkPlacement(
      { id: 'p', type: 'pinchos', ownerId: 'a', x: pos.x, y: pos.y, rotation: 0 },
      MAP_ASCENSO,
      [],
    );
    expect(check.valid).toBe(true);
  });

  it('si el puntero queda un poco metido en la plataforma, igual lo sube encima', () => {
    const pos = snapPlacement('hielo', 0, 180, 228, MAP_ASCENSO, []);
    expect(pos.y + 6).toBe(226);
  });

  it('lejos de cualquier superficie no lo mueve', () => {
    const pos = snapPlacement('tabla', 0, 240, 100, MAP_ASCENSO, []);
    expect(pos.y).toBe(Math.round((100 - 3) / PLACE_GRID) * PLACE_GRID);
  });

  it('se puede apilar encima de otro objeto', () => {
    const bloque = place({ id: 'b', type: 'bloque', x: 240, y: 150 });
    const pos = snapPlacement('pinchos', 0, 248, 145, MAP_ASCENSO, [bloque]);
    expect(pos.y + 6).toBe(150);
  });

  it('nunca lo deja fuera del mapa', () => {
    const pos = snapPlacement('viga', 0, 2000, -500, MAP_ASCENSO, []);
    expect(pos.x + objectType('viga')!.w).toBeLessThanOrEqual(480);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });
});
