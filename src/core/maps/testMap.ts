import { PLAYER_H, VIRTUAL_H, VIRTUAL_W } from '../constants';
import type { GameMap, Solid } from '../types';

/**
 * MAPA TECNICO - "TEST_MAP"
 *
 * Existe solamente para probar el sistema de multiples mapas de punta a
 * punta (registry, seleccion en el lobby, sincronizacion, MatchSession,
 * rollback) con una segunda definicion real y distinta de ASCENSO. No busca
 * ser divertido ni tener identidad visual: es deliberadamente minimo, una
 * escalera derecha con un piso corrido abajo (sin huecos que cruzar) y
 * subidas de 32px, dentro de la altura de salto (~46px) para que se pueda
 * jugar de verdad y no solo compilar.
 *
 * Se puede borrar o reemplazar por un mapa de verdad sin que nada mas del
 * juego lo note: esa es la prueba de que el sistema funciona.
 */

const WALLS: Solid[] = [
  { x: -12, y: -80, w: 12, h: VIRTUAL_H + 160 },
  { x: VIRTUAL_W, y: -80, w: 12, h: VIRTUAL_H + 160 },
  { x: -12, y: -30, w: VIRTUAL_W + 24, h: 20 },
];

const SOLIDS: Solid[] = [
  { x: 0, y: 234, w: 480, h: 36 }, // 1 - piso corrido, sin huecos que cruzar
  { x: 170, y: 202, w: 140, h: 8 }, // 2
  { x: 90, y: 170, w: 140, h: 8, oneWay: true }, // 3 - one-way, se atraviesa desde abajo
  { x: 190, y: 138, w: 140, h: 8 }, // 4
  { x: 280, y: 106, w: 140, h: 10 }, // 5 - meseta de meta
];

export const MAP_TEST: GameMap = {
  id: 'TEST_MAP',
  name: 'TEST_MAP',
  width: VIRTUAL_W,
  height: VIRTUAL_H,
  spawns: [
    { x: 20, y: 234 - PLAYER_H },
    { x: 50, y: 234 - PLAYER_H },
    { x: 80, y: 234 - PLAYER_H },
    { x: 110, y: 234 - PLAYER_H },
  ],
  solids: [...SOLIDS, ...WALLS],
  // Flotando sobre el piso, fuera del camino obligado (mismo criterio que
  // ASCENSO: un hazard nunca se para en la unica ruta posible).
  hazards: [{ x: 340, y: 228, w: 16, h: 6 }],
  goal: { x: 340, y: 82, w: 18, h: 24 },
};
