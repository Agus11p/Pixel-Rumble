/**
 * Constantes del juego.
 *
 * Todas las unidades de fisica estan en pixeles virtuales y segundos.
 * La simulacion corre a TICK_RATE fijo, asi que el paso de integracion
 * siempre es DT: nunca se usa el delta real del navegador dentro de core/.
 */

// ---------------------------------------------------------------- resolucion

/** Ancho de la resolucion virtual. Todo el juego se disena sobre esta grilla. */
export const VIRTUAL_W = 480;
/** Alto de la resolucion virtual (16:9). */
export const VIRTUAL_H = 270;

/** Grilla de referencia para disenar el mapa y, mas adelante, encajar objetos. */
export const GRID = 8;

// --------------------------------------------------------------------- tiempo

/** Ticks de simulacion por segundo. Fijo e independiente del framerate. */
export const TICK_RATE = 60;
/** Duracion de un tick en segundos. */
export const DT = 1 / TICK_RATE;
/** Duracion de un tick en milisegundos. */
export const MS_PER_TICK = 1000 / TICK_RATE;

// ------------------------------------------------------------------ personaje

export const PLAYER_W = 10;
export const PLAYER_H = 14;

// -------------------------------------------------------------------- fisica
// Estos numeros son EL game feel. Tocar de a poco y probar.

/** Velocidad horizontal maxima al correr (px/s). */
export const MAX_RUN = 130;
/** Aceleracion horizontal en el suelo (px/s^2). */
export const RUN_ACCEL = 900;
/** Aceleracion horizontal en el aire (px/s^2). Menor = menos control aereo. */
export const AIR_ACCEL = 620;
/** Frenado en el suelo al soltar la direccion (px/s^2). */
export const GROUND_FRICTION = 1000;
/** Frenado en el aire al soltar la direccion (px/s^2). */
export const AIR_FRICTION = 260;

/** Gravedad base al subir (px/s^2). */
export const GRAVITY = 850;
/** Multiplicador de gravedad al caer. >1 hace la caida mas pesada y snappy. */
export const FALL_MULT = 1.35;
/** Velocidad terminal de caida (px/s). */
export const MAX_FALL = 330;

/** Impulso vertical del salto (px/s). Da ~46px de altura. */
export const JUMP_SPEED = 272;
/** Al soltar el salto, la velocidad hacia arriba se recorta a este valor (px/s). */
export const JUMP_CUT_SPEED = 90;

/** Cerca del apice la gravedad se reduce: el salto se siente mas flotante. */
export const APEX_THRESHOLD = 34;
export const APEX_MULT = 0.68;

/** Ticks en los que todavia se puede saltar tras dejar el piso (coyote time). */
export const COYOTE_TICKS = 6;
/** Ticks que se recuerda un salto pedido en el aire (jump buffer). */
export const JUMP_BUFFER_TICKS = 7;

/** Paso maximo por subiteracion de colision (px). */
export const MAX_COLLISION_STEP = 4;

/** Margen bajo el mapa a partir del cual el jugador muere. */
export const DEATH_MARGIN = 24;

/** Tolerancia para decidir si el jugador venia por encima de una plataforma one-way. */
export const ONEWAY_TOLERANCE = 2;
