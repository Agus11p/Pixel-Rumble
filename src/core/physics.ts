import { MAX_COLLISION_STEP, ONEWAY_TOLERANCE, PLAYER_H, PLAYER_W } from './constants';
import type { PlayerState, Rect, Solid } from './types';

/** Colision AABB clasica (bordes tocandose no cuentan como solape). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Caja de colision del jugador en su posicion actual. */
export function playerRect(p: PlayerState): Rect {
  return { x: p.x, y: p.y, w: PLAYER_W, h: PLAYER_H };
}

/** Mueve `v` hacia `target` como mucho `maxDelta`. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return target;
}

/**
 * Desplazamiento horizontal con resolucion de colisiones.
 *
 * Se subdivide en pasos de como mucho MAX_COLLISION_STEP px para que nunca
 * se pueda atravesar un solido fino a alta velocidad. Las plataformas one-way
 * se ignoran por completo en el eje X.
 */
export function moveX(p: PlayerState, dx: number, solids: readonly Solid[]): boolean {
  if (dx === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(dx) / MAX_COLLISION_STEP));
  const inc = dx / steps;
  for (let i = 0; i < steps; i++) {
    if (stepX(p, inc, solids)) return true;
  }
  return false;
}

function stepX(p: PlayerState, dx: number, solids: readonly Solid[]): boolean {
  p.x += dx;
  let hit = false;
  for (const s of solids) {
    if (s.oneWay) continue;
    if (!overlaps(playerRect(p), s)) continue;
    p.x = dx > 0 ? s.x - PLAYER_W : s.x + s.w;
    hit = true;
  }
  if (hit) p.vx = 0;
  return hit;
}

/**
 * Desplazamiento vertical con resolucion de colisiones.
 * Actualiza `onGround` cuando el jugador apoya sobre un solido.
 */
export function moveY(p: PlayerState, dy: number, solids: readonly Solid[]): boolean {
  if (dy === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / MAX_COLLISION_STEP));
  const inc = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (stepY(p, inc, solids)) return true;
  }
  return false;
}

function stepY(p: PlayerState, dy: number, solids: readonly Solid[]): boolean {
  const prevBottom = p.y + PLAYER_H;
  p.y += dy;
  let hit = false;
  let bounce = 0;
  for (const s of solids) {
    if (s.oneWay) {
      // Solo frena si venimos cayendo y los pies estaban por encima del borde.
      if (dy <= 0) continue;
      if (prevBottom > s.y + ONEWAY_TOLERANCE) continue;
    }
    if (!overlaps(playerRect(p), s)) continue;
    if (dy > 0) {
      p.y = s.y - PLAYER_H;
      p.onGround = true;
      // El suelo que se pisa manda: hielo resbala, brea frena.
      p.groundFriction = s.friction ?? 1;
      if (s.bounce) bounce = Math.max(bounce, s.bounce);
    } else {
      p.y = s.y + s.h;
    }
    hit = true;
  }

  if (bounce > 0) {
    // Impulso externo: no es un salto propio, asi que soltar el boton no lo
    // recorta y el jugador llega arriba del todo.
    p.vy = -bounce;
    p.jumping = false;
    p.onGround = false;
    return true;
  }
  if (hit) p.vy = 0;
  return hit;
}
