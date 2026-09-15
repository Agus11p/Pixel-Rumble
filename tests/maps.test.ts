import { describe, expect, it } from 'vitest';
import { PLAYER_H } from '../src/core/constants';
import { MAP_ASCENSO, PLATFORMS } from '../src/core/maps/ascenso';
import {
  DEFAULT_MAP_ID,
  getMap,
  isValidMapId,
  listMaps,
  resolveMap,
} from '../src/core/maps/registry';
import { MAP_TEST } from '../src/core/maps/testMap';
import { assertValidMap, isValidMap, validateMap } from '../src/core/maps/validate';
import { createWorld, everyoneDone, step } from '../src/core/simulation';
import { RollbackSim } from '../src/net/RollbackSim';
import type { GameMap } from '../src/core/types';
import { input, solo } from './helpers';

describe('registry', () => {
  it('ASCENSO existe en el registry', () => {
    expect(getMap('ASCENSO')).toBe(MAP_ASCENSO);
  });

  it('TEST_MAP existe en el registry', () => {
    expect(getMap('TEST_MAP')).toBe(MAP_TEST);
  });

  it('lista todos los mapas registrados, sin repetidos', () => {
    const maps = listMaps();
    const ids = maps.map((m) => m.id);
    expect(ids).toContain('ASCENSO');
    expect(ids).toContain('TEST_MAP');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('obtener un mapa por id devuelve exactamente esa definicion', () => {
    expect(getMap('ASCENSO')).toEqual(MAP_ASCENSO);
  });

  it('un id inexistente falla claramente con resolveMap', () => {
    expect(() => resolveMap('NO_EXISTE')).toThrow(/NO_EXISTE/);
  });

  it('un id inexistente con getMap devuelve undefined, no explota', () => {
    expect(getMap('NO_EXISTE')).toBeUndefined();
  });

  it('isValidMapId distingue ids reales de inventados', () => {
    expect(isValidMapId('ASCENSO')).toBe(true);
    expect(isValidMapId('TEST_MAP')).toBe(true);
    expect(isValidMapId('NO_EXISTE')).toBe(false);
  });

  it('el mapa por defecto es uno realmente registrado', () => {
    expect(isValidMapId(DEFAULT_MAP_ID)).toBe(true);
  });

  it('todos los mapas registrados pasan su propia validacion', () => {
    for (const map of listMaps()) {
      expect(validateMap(map), `${map.id} tiene problemas`).toEqual([]);
    }
  });
});

describe('ASCENSO conserva sus datos actuales tras la migracion', () => {
  it('sigue siendo el mismo circuito de 12 plataformas', () => {
    expect(PLATFORMS).toHaveLength(12);
    expect(MAP_ASCENSO.spawns).toHaveLength(4);
    expect(MAP_ASCENSO.goal).toEqual({ x: 404, y: 16, w: 18, h: 24 });
    expect(MAP_ASCENSO.hazards).toHaveLength(3);
  });

  it('tiene id y metadata nuevos sin tocar la geometria', () => {
    expect(MAP_ASCENSO.id).toBe('ASCENSO');
    expect(MAP_ASCENSO.width).toBe(480);
    expect(MAP_ASCENSO.height).toBe(270);
  });
});

describe('validacion de mapas', () => {
  const base: GameMap = {
    id: 'X',
    name: 'X',
    width: 480,
    height: 270,
    spawns: [{ x: 10, y: 10 }],
    solids: [],
    hazards: [],
    goal: { x: 100, y: 100, w: 16, h: 16 },
  };

  it('un mapa razonable pasa', () => {
    expect(isValidMap(base)).toBe(true);
  });

  it('rechaza dimensiones no positivas', () => {
    expect(isValidMap({ ...base, width: 0 })).toBe(false);
    expect(isValidMap({ ...base, height: -10 })).toBe(false);
  });

  it('rechaza un mapa sin ningun spawn', () => {
    expect(isValidMap({ ...base, spawns: [] })).toBe(false);
  });

  it('rechaza un spawn fuera del mapa', () => {
    expect(isValidMap({ ...base, spawns: [{ x: 999, y: 10 }] })).toBe(false);
  });

  it('rechaza una meta invalida (area cero o fuera de mapa)', () => {
    expect(isValidMap({ ...base, goal: { x: 10, y: 10, w: 0, h: 10 } })).toBe(false);
    expect(isValidMap({ ...base, goal: { x: 10, y: 10, w: 10, h: 0 } })).toBe(false);
    expect(isValidMap({ ...base, goal: { x: 9999, y: 10, w: 10, h: 10 } })).toBe(false);
  });

  it('rechaza un solido con ancho o alto cero', () => {
    expect(isValidMap({ ...base, solids: [{ x: 0, y: 0, w: 0, h: 10 }] })).toBe(false);
  });

  it('rechaza un solido absurdamente lejos del mapa', () => {
    expect(isValidMap({ ...base, solids: [{ x: 100000, y: 0, w: 10, h: 10 }] })).toBe(false);
  });

  it('tolera un margen razonable (muros que sobresalen un poco, como en ASCENSO)', () => {
    expect(isValidMap({ ...base, solids: [{ x: -12, y: -30, w: 500, h: 20 }] })).toBe(true);
  });

  it('rechaza un hazard invalido igual que un solido', () => {
    expect(isValidMap({ ...base, hazards: [{ x: 0, y: 0, w: 0, h: 10 }] })).toBe(false);
  });

  it('rechaza un id o un nombre vacio', () => {
    expect(isValidMap({ ...base, id: '' })).toBe(false);
    expect(isValidMap({ ...base, name: '' })).toBe(false);
  });

  it('un mapa invalido explota con assertValidMap, no queda en un estado raro', () => {
    expect(() => assertValidMap({ ...base, spawns: [] })).toThrow(/invalido/i);
  });

  it('un mapa valido no explota con assertValidMap', () => {
    expect(() => assertValidMap(base)).not.toThrow();
  });
});

describe('TEST_MAP funciona como mapa de verdad', () => {
  it('tiene spawns validos, dentro del mapa', () => {
    expect(MAP_TEST.spawns.length).toBeGreaterThan(0);
    for (const s of MAP_TEST.spawns) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(MAP_TEST.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(MAP_TEST.height);
    }
  });

  it('tiene una meta valida', () => {
    expect(MAP_TEST.goal.w).toBeGreaterThan(0);
    expect(MAP_TEST.goal.h).toBeGreaterThan(0);
  });

  it('puede iniciar una simulacion normal', () => {
    const world = createWorld(MAP_TEST, ['a', 'b']);
    expect(world.players).toHaveLength(2);
    expect(world.players[0]!.phase).toBe('racing');
    step(world, solo(input()));
    expect(world.tick).toBe(1);
  });

  it('un jugador puede llegar a la meta encadenando los 4 saltos del mapa', () => {
    // Cada escalon de TEST_MAP sube 32px, bien por debajo de la altura de
    // salto (~46px), con harto solape horizontal entre plataformas. Se prueba
    // en 3 fases por salto (acercarse, saltar sosteniendo el arco completo,
    // dejar que aterrice) para no depender de un timing pixel-perfect - igual
    // de generoso que como se disenaron los huecos. Si esto se rompe, el mapa
    // dejo de ser jugable con la fisica vigente.
    const world = createWorld(MAP_TEST, ['local']);
    const p = world.players[0]!;

    function runTo(dir: 1 | -1, targetX: number, maxTicks: number): void {
      let i = 0;
      while (i++ < maxTicks && (dir > 0 ? p.x < targetX : p.x > targetX)) {
        step(world, solo(input({ left: dir < 0, right: dir > 0 })));
      }
    }

    function jumpTo(dir: 1 | -1, settleTicks: number): void {
      // Sostiene el salto lo suficiente para completar el arco sin cortarlo.
      for (let i = 0; i < 24; i++) {
        step(world, solo(input({ left: dir < 0, right: dir > 0, jump: true })));
      }
      // Y sigue en la misma direccion hasta aterrizar.
      let i = 0;
      while (i++ < settleTicks && !p.onGround) {
        step(world, solo(input({ left: dir < 0, right: dir > 0 })));
      }
    }

    // El despegue de cada salto se posiciona ANTES del borde de la plataforma
    // solida de destino (no debajo, en el centro): saltar justo debajo de un
    // solido pega contra su cara inferior en vez de pasar por el costado,
    // igual que le pasaria a un jugador real. El escalon 3 es one-way y ese
    // no tiene el problema (se atraviesa de abajo sin chocar).
    runTo(1, 150, 150);
    jumpTo(1, 80); // piso -> escalon 2 (y=202, x 170-310)
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(202 - PLAYER_H, 0);

    runTo(-1, 250, 100);
    jumpTo(-1, 80); // escalon 2 -> escalon 3, one-way (y=170, x 90-230)
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(170 - PLAYER_H, 0);

    runTo(1, 170, 100);
    jumpTo(1, 80); // escalon 3 -> escalon 4 (y=138, x 190-330)
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(138 - PLAYER_H, 0);

    runTo(1, 260, 100);
    jumpTo(1, 80); // escalon 4 -> meseta de meta (y=106, x 280-420)
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(106 - PLAYER_H, 0);

    runTo(1, 345, 60); // camina sobre la meseta hasta tocar la meta (x=340-358)
    expect(p.phase).toBe('finished');
  });

  it('el rollback funciona igual que en ASCENSO (independiente del mapa)', () => {
    const sim = new RollbackSim(MAP_TEST, ['a', 'b']);
    sim.applyInput('a', 5, input({ right: true, jump: true }));
    sim.advanceTo(60);
    // Input tardio: fuerza un rollback real.
    sim.applyInput('b', 10, input({ right: true }));
    expect(sim.rollbackCount).toBeGreaterThan(0);
    expect(sim.world.tick).toBe(60);
  });

  it('una ronda en TEST_MAP puede terminar (todos dejan de correr)', () => {
    const world = createWorld(MAP_TEST, ['a', 'b']);
    world.players[0]!.phase = 'finished';
    world.players[0]!.endTick = 10;
    world.players[1]!.phase = 'dead';
    world.players[1]!.endTick = 12;
    expect(everyoneDone(world)).toBe(true);
  });
});
