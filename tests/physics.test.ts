import { describe, expect, it } from 'vitest';
import { approach, moveX, moveY, overlaps } from '../src/core/physics';
import { createPlayer } from '../src/core/simulation';
import { MAP_ASCENSO } from '../src/core/map';
import { PLAYER_H, PLAYER_W } from '../src/core/constants';
import type { Solid } from '../src/core/types';

describe('overlaps', () => {
  it('detecta solape real', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('bordes que se tocan no son solape', () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('approach', () => {
  it('no pasa de largo el objetivo', () => {
    expect(approach(0, 100, 30)).toBe(30);
    expect(approach(90, 100, 30)).toBe(100);
    expect(approach(-90, 0, 30)).toBe(-60);
  });
});

describe('colisiones', () => {
  const solids: Solid[] = [{ x: 100, y: 100, w: 50, h: 10 }];

  it('frena contra una pared a la derecha', () => {
    const p = createPlayer(MAP_ASCENSO, 'local', 0);
    p.x = 80;
    p.y = 100;
    p.vx = 200;
    moveX(p, 40, solids);
    expect(p.x).toBe(100 - PLAYER_W);
    expect(p.vx).toBe(0);
  });

  it('apoya sobre un solido al caer', () => {
    const p = createPlayer(MAP_ASCENSO, 'local', 0);
    p.x = 110;
    p.y = 80;
    p.vy = 300;
    moveY(p, 30, solids);
    expect(p.y).toBe(100 - PLAYER_H);
    expect(p.onGround).toBe(true);
    expect(p.vy).toBe(0);
  });

  it('no atraviesa un solido fino a alta velocidad (subpasos)', () => {
    const thin: Solid[] = [{ x: 100, y: 100, w: 50, h: 2 }];
    const p = createPlayer(MAP_ASCENSO, 'local', 0);
    p.x = 110;
    p.y = 60;
    p.vy = 1000;
    moveY(p, 60, thin);
    expect(p.y).toBe(100 - PLAYER_H);
    expect(p.onGround).toBe(true);
  });
});
