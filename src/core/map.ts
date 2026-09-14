import { PLAYER_H, VIRTUAL_H, VIRTUAL_W } from './constants';
import type { GameMap, Solid } from './types';

/**
 * MAPA 01 - "ASCENSO"
 *
 * Circuito de una sola pantalla (480x270). Arranca abajo a la izquierda,
 * sube en zigzag y termina arriba a la derecha.
 *
 * Referencias de diseno con la fisica actual:
 *   - altura maxima de salto:  ~46 px
 *   - alcance horizontal:      ~78 px en el aire
 * Por eso ningun hueco pasa de 58 px ni ninguna subida de 32 px: todo se
 * puede encadenar sin pixel-perfect, pero sin sobrar demasiado.
 *
 * Los muros laterales existen para que nadie salga de cuadro: la unica
 * forma de morir cayendo es por abajo (la camara es fija, §18).
 */

const WALLS: Solid[] = [
  { x: -12, y: -80, w: 12, h: VIRTUAL_H + 160 }, // muro izquierdo
  { x: VIRTUAL_W, y: -80, w: 12, h: VIRTUAL_H + 160 }, // muro derecho
  { x: -12, y: -30, w: VIRTUAL_W + 24, h: 20 }, // techo
];

/** Plataformas del recorrido, en orden de salida a meta. */
export const PLATFORMS: Solid[] = [
  { x: 0, y: 252, w: 120, h: 18 }, // 1 - salida
  { x: 150, y: 226, w: 60, h: 8 }, // 2
  { x: 236, y: 200, w: 54, h: 8 }, // 3
  { x: 320, y: 214, w: 46, h: 8 }, // 4
  { x: 404, y: 190, w: 76, h: 8 }, // 5 - repecho derecho
  { x: 330, y: 158, w: 56, h: 6, oneWay: true }, // 6 - se atraviesa desde abajo
  { x: 236, y: 136, w: 52, h: 8 }, // 7
  { x: 140, y: 112, w: 56, h: 8 }, // 8
  { x: 44, y: 90, w: 60, h: 8 }, // 9 - extremo izquierdo
  { x: 150, y: 66, w: 48, h: 6, oneWay: true }, // 10
  { x: 246, y: 48, w: 52, h: 8 }, // 11
  { x: 348, y: 40, w: 98, h: 10 }, // 12 - meseta de meta
];

export const MAP_ASCENSO: GameMap = {
  name: 'ASCENSO',
  // Cuatro salidas separadas sobre la plataforma inicial.
  spawns: [
    { x: 10, y: 252 - PLAYER_H },
    { x: 32, y: 252 - PLAYER_H },
    { x: 54, y: 252 - PLAYER_H },
    { x: 76, y: 252 - PLAYER_H },
  ],
  solids: [...PLATFORMS, ...WALLS],
  // Regla de diseno: ningun peligro se para en la carrera de impulso de una
  // plataforma. Los pinches van flotando en los huecos, asi castigan al que
  // salta corto en vez de bloquear el envion (lo verifica course.test.ts).
  hazards: [
    { x: 214, y: 232, w: 16, h: 6 }, // hueco 2 -> 3
    { x: 200, y: 142, w: 16, h: 6 }, // hueco 7 -> 8
    { x: 110, y: 96, w: 16, h: 6 }, // hueco 9 -> 10
  ],
  goal: { x: 404, y: 16, w: 18, h: 24 },
};
