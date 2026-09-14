import { describe, expect, it } from 'vitest';
import type { RoundContext, RoundOutcome } from '../src/core/scoring';
import {
  SCORING,
  addToTotals,
  isLast,
  lateBonusFor,
  matchIsOver,
  scoreRound,
  standings,
  totalsBeforeRound,
  winners,
} from '../src/core/scoring';

const finished = (id: string, endTick: number): RoundOutcome => ({
  id,
  phase: 'finished',
  endTick,
});
const dead = (id: string, endTick: number, killedBy: string | null = null): RoundOutcome => ({
  id,
  phase: 'dead',
  endTick,
  killedBy,
});

const ROUND_1: RoundContext = { round: 1, totalsBefore: {} };

function pointsOf(outcomes: RoundOutcome[], ctx: RoundContext = ROUND_1): Record<string, number> {
  return Object.fromEntries(scoreRound(outcomes, ctx).scores.map((s) => [s.id, s.points]));
}

function reasonsOf(outcomes: RoundOutcome[], id: string, ctx: RoundContext = ROUND_1): string[] {
  return scoreRound(outcomes, ctx).scores.find((s) => s.id === id)!.reasons.map((r) => r.kind);
}

describe('regla de oro', () => {
  it('si llegan todos, nadie suma nada', () => {
    const r = scoreRound([finished('a', 300), finished('b', 340)], ROUND_1);
    expect(r.voided).toBe('everyoneArrived');
    expect(r.scores.every((s) => s.points === 0)).toBe(true);
  });

  it('si mueren todos, nadie suma nada', () => {
    const r = scoreRound([dead('a', 300), dead('b', 340)], ROUND_1);
    expect(r.voided).toBe('nobodyArrived');
    expect(r.scores.every((s) => s.points === 0)).toBe(true);
  });

  it('si mueren todos, tampoco cuentan las trampas', () => {
    const r = scoreRound([dead('a', 300, 'b'), dead('b', 340)], ROUND_1);
    expect(r.voided).toBe('nobodyArrived');
    expect(pointsOf([dead('a', 300, 'b'), dead('b', 340)]).b).toBe(0);
  });

  it('quedarse sin tiempo cuenta como no llegar', () => {
    const outOfTime: RoundOutcome = { id: 'b', phase: 'racing', endTick: -1 };
    const r = scoreRound([finished('a', 300), outOfTime], ROUND_1);
    expect(r.voided).toBe(null);
  });
});

describe('categorias de puntos', () => {
  it('meta +100 y primero +100 extra', () => {
    const p = pointsOf([finished('a', 300), finished('b', 340), dead('c', 100)]);
    expect(p.a).toBe(SCORING.goal + SCORING.first);
    expect(p.b).toBe(SCORING.goal);
    expect(p.c).toBe(0);
  });

  it('solitario: +100 al unico que llega (ademas de meta y primero)', () => {
    const outcomes = [finished('a', 300), dead('b', 100), dead('c', 150)];
    expect(reasonsOf(outcomes, 'a')).toEqual(['goal', 'first', 'solo']);
    expect(pointsOf(outcomes).a).toBe(300);
  });

  it('trampa: +200 por cada rival eliminado', () => {
    const p = pointsOf([finished('c', 300), dead('a', 120, 'b'), dead('d', 150, 'b'), dead('b', 200)]);
    expect(p.b).toBe(2 * SCORING.trap);
  });

  it('se suma por trampas aunque uno mismo no llegue', () => {
    const p = pointsOf([finished('a', 300), dead('b', 120, 'c'), dead('c', 200)]);
    expect(p.c).toBe(SCORING.trap);
  });

  it('la trampa propia nunca da puntos', () => {
    const p = pointsOf([finished('a', 300), dead('b', 120, 'b')]);
    expect(p.b).toBe(0);
  });

  it('llegar en el mismo tick que otro: los dos son primeros', () => {
    const p = pointsOf([finished('a', 300), finished('b', 300), dead('c', 1)]);
    expect(p.a).toBe(200);
    expect(p.b).toBe(200);
  });

  it('remontada: +100 si llegas estando ultimo en la tabla', () => {
    const ctx: RoundContext = { round: 4, totalsBefore: { a: 800, b: 100, c: 500 } };
    const outcomes = [finished('b', 300), finished('a', 320), dead('c', 50)];
    expect(reasonsOf(outcomes, 'b', ctx)).toContain('comeback');
    expect(reasonsOf(outcomes, 'a', ctx)).not.toContain('comeback');
  });

  it('en la primera ronda nadie esta ultimo: todos empatados en cero', () => {
    const outcomes = [finished('a', 300), dead('b', 100)];
    expect(reasonsOf(outcomes, 'a')).not.toContain('comeback');
  });

  it('empatado en el ultimo lugar tambien cuenta como remontada', () => {
    const ctx: RoundContext = { round: 3, totalsBefore: { a: 100, b: 100, c: 600 } };
    const outcomes = [finished('a', 300), dead('b', 100), dead('c', 120)];
    expect(reasonsOf(outcomes, 'a', ctx)).toContain('comeback');
  });
});

describe('rondas tardias', () => {
  it('no hay bono al principio de la partida', () => {
    expect(lateBonusFor(1)).toBe(0);
    expect(lateBonusFor(6)).toBe(0);
  });

  it('despues de la ronda 6 y de la 10 llegar vale mas', () => {
    expect(lateBonusFor(7)).toBeGreaterThan(0);
    expect(lateBonusFor(11)).toBeGreaterThan(lateBonusFor(7));
  });

  it('el bono se suma solo a quien llega', () => {
    const ctx: RoundContext = { round: 8, totalsBefore: {} };
    const p = pointsOf([finished('a', 300), finished('b', 400), dead('c', 100)], ctx);
    expect(p.b).toBe(SCORING.goal + lateBonusFor(8));
    expect(p.c).toBe(0);
  });
});

describe('fin de partida', () => {
  it('no termina mientras nadie llegue al limite', () => {
    expect(matchIsOver({ a: 1900, b: 1200 }, 2000, 5)).toBe(false);
  });

  it('termina cuando alguien alcanza el limite', () => {
    expect(matchIsOver({ a: 2000, b: 1200 }, 2000, 5)).toBe(true);
    expect(winners({ a: 2000, b: 1200 })).toEqual(['a']);
  });

  it('si varios lo superan, gana el de mas puntos', () => {
    const totals = { a: 2300, b: 2100 };
    expect(matchIsOver(totals, 2000, 9)).toBe(true);
    expect(winners(totals)).toEqual(['a']);
  });

  it('si empatan justo arriba del limite, se juega otra ronda', () => {
    expect(matchIsOver({ a: 2200, b: 2200 }, 2000, 9)).toBe(false);
  });

  it('el tope de rondas corta partidas que no avanzan', () => {
    expect(matchIsOver({ a: 300, b: 200 }, 2000, SCORING.maxRounds)).toBe(true);
  });
});

describe('tabla general', () => {
  it('suma los puntos de la ronda al total', () => {
    const { scores } = scoreRound([finished('a', 300), dead('b', 100)], ROUND_1);
    expect(addToTotals({ a: 400, b: 800 }, scores)).toEqual({ a: 700, b: 800 });
  });

  it('se puede reconstruir la tabla previa a la ronda', () => {
    expect(totalsBeforeRound({ a: 700, b: 800 }, { a: 300, b: 0 })).toEqual({ a: 400, b: 800 });
  });

  it('isLast no marca a nadie cuando todos estan igual', () => {
    expect(isLast('a', { a: 0, b: 0 }, ['a', 'b'])).toBe(false);
  });

  it('ordena de mayor a menor con empates marcados', () => {
    const table = standings({ a: 1000, b: 1000, c: 400 });
    expect(table.map((s) => s.place)).toEqual([1, 1, 3]);
    expect(table[0]!.tied).toBe(true);
    expect(table[2]!.tied).toBe(false);
  });
});
