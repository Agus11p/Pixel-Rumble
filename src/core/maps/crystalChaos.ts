import { PLAYER_H, VIRTUAL_H, VIRTUAL_W } from '../constants';
import type { GameMap, Solid } from '../types';

/**
 * MAPA 02 - "CRYSTAL CHAOS" (CRYSTAL_CHAOS)
 *
 * Primer mapa "de verdad" de Pixel Rumble. El tema es una zona de cristales
 * flotantes suspendidos en el aire - hoy la geometria es placeholder (los
 * mismos rectangulos que ASCENSO/TEST_MAP), pero el DISEÑO ya piensa en eso:
 * plataformas chicas y separadas en vez de terreno solido continuo.
 *
 * Lectura del recorrido (una sola pantalla, camara fija, igual que ASCENSO):
 *
 *   SPAWN (aprendizaje)
 *     -> zona de aprendizaje (saltos triviales, plataformas anchas)
 *     -> primer riesgo (hueco obligado + hazard flotando bajo el arco)
 *     -> FORK: decision de ruta
 *          RUTA SEGURA: dos saltos chicos y comodos sobre plataformas anchas
 *          RUTA RAPIDA: un solo salto largo (60px) a una plataforma angosta
 *     -> ambas rutas convergen en la ZONA DE CAOS (cluster de plataformas a
 *        distinta altura, ancho, pensada para que 2-4 jugadores esten ahi a
 *        la vez y para colocar objetos)
 *     -> tramo final (hazard guardando la aproximacion + plataforma angosta)
 *     -> META, en una meseta ancha separada del spawn por todo el recorrido.
 *
 * Referencias de fisica usadas para disenar (medidas con la simulacion real,
 * no a ojo - ver tests/crystalChaos.test.ts):
 *   - altura de salto sostenido: ~41px          (toque corto: ~20px)
 *   - alcance horizontal corriendo: ~70px       (parado: ~58px)
 * Por eso ningun salto de esta ruta principal pasa de 60px de hueco ni de
 * 32px de subida, salvo la ruta rapida (60px + 32px combinados a proposito,
 * es la opcion de mayor riesgo) y el margen de error siempre queda de sobra
 * respecto del maximo medido.
 */

const WALLS: Solid[] = [
  { x: -12, y: -80, w: 12, h: VIRTUAL_H + 160 },
  { x: VIRTUAL_W, y: -80, w: 12, h: VIRTUAL_H + 160 },
  { x: -12, y: -30, w: VIRTUAL_W + 24, h: 20 },
];

/** Plataformas del recorrido principal, en orden de salida a meta. */
export const CRYSTAL_PLATFORMS: Solid[] = [
  { x: 0, y: 252, w: 120, h: 18 }, // 1 - spawn, ancha para 4 jugadores
  { x: 150, y: 228, w: 80, h: 8 }, // 2 - aprendizaje: salto trivial
  { x: 270, y: 210, w: 80, h: 8 }, // 3 - aprendizaje: salto trivial
  { x: 400, y: 192, w: 70, h: 10 }, // 4 - FORK: plataforma de decision, ancha
  // -- ruta segura: dos saltos chicos y comodos --
  { x: 330, y: 172, w: 60, h: 8 }, // 5a
  { x: 250, y: 150, w: 70, h: 8 }, // 6a - converge con la ruta rapida
  // -- ruta rapida: un salto largo (60px) a una plataforma angosta --
  { x: 300, y: 160, w: 40, h: 8 }, // 5b
  // -- zona de caos: cluster a distinta altura, ancho --
  { x: 180, y: 130, w: 70, h: 8 }, // 7
  { x: 280, y: 108, w: 70, h: 6, oneWay: true }, // 8 - se atraviesa desde abajo
  { x: 160, y: 90, w: 60, h: 8 }, // 9
  // -- tramo final: mas angosto, guardado por un hazard --
  { x: 260, y: 64, w: 50, h: 8 }, // 10
  { x: 340, y: 40, w: 100, h: 10 }, // 11 - meseta de meta
];

export const MAP_CRYSTAL_CHAOS: GameMap = {
  id: 'CRYSTAL_CHAOS',
  name: 'CRYSTAL CHAOS',
  width: VIRTUAL_W,
  height: VIRTUAL_H,
  // 4 spawns separados sobre la plataforma inicial, igual de anchos que en
  // ASCENSO: nadie aparece encimado y los 4 caben mirando hacia el resto del
  // recorrido sin bloquearse.
  spawns: [
    { x: 10, y: 252 - PLAYER_H },
    { x: 32, y: 252 - PLAYER_H },
    { x: 54, y: 252 - PLAYER_H },
    { x: 76, y: 252 - PLAYER_H },
  ],
  solids: [...CRYSTAL_PLATFORMS, ...WALLS],
  // Pocos hazards, cada uno con un proposito (§ "hazards" del brief):
  //  - primer riesgo: flotando en el primer hueco obligado del mapa.
  //  - tramo final: guardando la aproximacion a la meta.
  // Ninguno se para en la ruta segura ni en la rapida: van mas abajo que el
  // arco de un salto bueno, asi solo castigan un salto corto o directamente
  // no saltar (mismo criterio que ya usan ASCENSO y TEST_MAP).
  hazards: [
    { x: 365, y: 222, w: 16, h: 6 }, // hueco aprendizaje -> FORK
    { x: 220, y: 84, w: 16, h: 6 }, // hueco zona de caos -> tramo final
  ],
  goal: { x: 395, y: 16, w: 18, h: 24 },
};
