import type { PlayerPhase } from './types';

/**
 * PUNTUACION
 *
 * Todas las reglas de puntos viven aca y solo aca. Ninguna otra parte del juego
 * sabe cuanto vale llegar a la meta: si cambian los numeros, se cambian en la
 * tabla SCORING y no hay que buscar nada por el resto del codigo.
 *
 * 1. REGLA DE ORO (consenso)
 *    Para que alguien sume en una ronda, al menos uno tiene que llegar y al
 *    menos uno tiene que quedar afuera (morir, rendirse o no llegar a tiempo).
 *      - Si llegan todos: nadie suma, el nivel quedo demasiado facil.
 *      - Si no llega nadie: nadie suma, el nivel quedo demasiado dificil.
 *
 * 2. CATEGORIAS (solo si se cumple la regla de oro)
 *      - Meta:      +100 por llegar.
 *      - Primero:   +100 extra al primero en tocar la meta.
 *      - Trampa:    +200 por cada rival eliminado por una trampa propia,
 *                   aunque se haya colocado en una ronda anterior.
 *      - Solitario: +100 si sos el unico que llega.
 *      - Remontada: +100 si llegas estando ultimo en la tabla general.
 *      - Moneda:    pendiente (todavia no hay monedas en el mapa).
 *
 * 3. AJUSTES Y FIN
 *      - Rondas tardias: bono extra por llegar desde la ronda 7 y desde la 11,
 *        para que la partida no se estire.
 *      - Gana el primero en alcanzar el limite (2000 por defecto) al terminar
 *        una ronda. Si varios lo superan, gana el de mas puntos.
 */

export const SCORING = {
  goal: 100,
  first: 100,
  trap: 200,
  solo: 100,
  comeback: 100,
  /** Bono por llegar en rondas tardias. Se aplica el tramo mas alto alcanzado. */
  lateBonus: [
    { fromRound: 7, points: 50 },
    { fromRound: 11, points: 100 },
  ],
  /** Puntos para ganar la partida. */
  targetOptions: [1000, 2000, 3000],
  targetDefault: 2000,
  /**
   * Tope de seguridad: si en tantas rondas nadie llego al limite (por ejemplo,
   * porque casi nunca se cumple la regla de oro), gana el de mas puntos.
   */
  maxRounds: 30,
} as const;

export type ScoreReason =
  | { kind: 'goal'; points: number }
  | { kind: 'first'; points: number }
  | { kind: 'trap'; victim: string; points: number }
  | { kind: 'solo'; points: number }
  | { kind: 'comeback'; points: number }
  | { kind: 'late'; points: number };

/** Por que una ronda no repartio puntos. */
export type VoidReason = 'everyoneArrived' | 'nobodyArrived';

export interface RoundOutcome {
  id: string;
  phase: PlayerPhase;
  /** Tick en el que llego o murio. */
  endTick: number;
  /** Dueno del objeto que lo mato, si murio por una trampa. */
  killedBy?: string | null;
}

export interface RoundContext {
  round: number;
  /** Tabla general ANTES de esta ronda (para la remontada). */
  totalsBefore: Readonly<Record<string, number>>;
}

export interface RoundScore {
  id: string;
  points: number;
  reasons: ScoreReason[];
}

export interface RoundScoring {
  scores: RoundScore[];
  /** Si la regla de oro anulo la ronda, por que. */
  voided: VoidReason | null;
}

/** Bono por llegar segun la ronda. */
export function lateBonusFor(round: number): number {
  let bonus = 0;
  for (const tier of SCORING.lateBonus) if (round >= tier.fromRound) bonus = tier.points;
  return bonus;
}

/**
 * Esta ultimo en la tabla general. Si todos estan empatados (por ejemplo en la
 * primera ronda, todos con 0) nadie cuenta como ultimo: no hay nada que remontar.
 */
export function isLast(id: string, totals: Readonly<Record<string, number>>, ids: string[]): boolean {
  const values = ids.map((p) => totals[p] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min !== max && (totals[id] ?? 0) === min;
}

/** Puntos de una ronda para todos los participantes. */
export function scoreRound(outcomes: readonly RoundOutcome[], ctx: RoundContext): RoundScoring {
  const scores = new Map<string, RoundScore>();
  for (const o of outcomes) scores.set(o.id, { id: o.id, points: 0, reasons: [] });

  const finishers = outcomes
    .filter((o) => o.phase === 'finished')
    .sort((a, b) => a.endTick - b.endTick);

  // --- regla de oro --------------------------------------------------------
  let voided: VoidReason | null = null;
  if (finishers.length === 0) voided = 'nobodyArrived';
  else if (finishers.length === outcomes.length) voided = 'everyoneArrived';
  if (voided) return { scores: outcomes.map((o) => scores.get(o.id)!), voided };

  const award = (id: string, reason: ScoreReason): void => {
    const entry = scores.get(id);
    if (!entry) return;
    entry.points += reason.points;
    entry.reasons.push(reason);
  };

  const ids = outcomes.map((o) => o.id);
  const firstTick = finishers[0]!.endTick;
  const late = lateBonusFor(ctx.round);

  for (const o of finishers) {
    award(o.id, { kind: 'goal', points: SCORING.goal });
    // Si dos tocan la meta en el mismo tick, los dos son primeros.
    if (o.endTick === firstTick) award(o.id, { kind: 'first', points: SCORING.first });
    if (finishers.length === 1) award(o.id, { kind: 'solo', points: SCORING.solo });
    if (isLast(o.id, ctx.totalsBefore, ids)) {
      award(o.id, { kind: 'comeback', points: SCORING.comeback });
    }
    if (late > 0) award(o.id, { kind: 'late', points: late });
  }

  // Trampas: suman al dueno, nunca al que la piso si es el mismo.
  for (const o of outcomes) {
    if (o.phase === 'finished' || !o.killedBy || o.killedBy === o.id) continue;
    award(o.killedBy, { kind: 'trap', victim: o.id, points: SCORING.trap });
  }

  return { scores: outcomes.map((o) => scores.get(o.id)!), voided: null };
}

/** Suma los puntos de la ronda a los totales acumulados. */
export function addToTotals(
  totals: Readonly<Record<string, number>>,
  round: readonly RoundScore[],
): Record<string, number> {
  const next: Record<string, number> = { ...totals };
  for (const s of round) next[s.id] = (next[s.id] ?? 0) + s.points;
  return next;
}

/** Tabla general a partir de los totales y los puntos de la ultima ronda. */
export function totalsBeforeRound(
  totalsAfter: Readonly<Record<string, number>>,
  roundPoints: Readonly<Record<string, number>>,
): Record<string, number> {
  const before: Record<string, number> = {};
  for (const [id, total] of Object.entries(totalsAfter)) before[id] = total - (roundPoints[id] ?? 0);
  return before;
}

export interface Standing {
  id: string;
  points: number;
  place: number;
  /** Empatado con otro en el mismo puesto. */
  tied: boolean;
}

/** Tabla de posiciones ordenada, con empates marcados. */
export function standings(totals: Readonly<Record<string, number>>): Standing[] {
  const rows = Object.entries(totals)
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));

  let place = 0;
  let lastPoints = Number.NaN;
  return rows.map((row, index) => {
    if (row.points !== lastPoints) {
      place = index + 1;
      lastPoints = row.points;
    }
    const tied = rows.filter((r) => r.points === row.points).length > 1;
    return { id: row.id, points: row.points, place, tied };
  });
}

/** Quien va primero en la tabla. Puede haber empate. */
export function winners(totals: Readonly<Record<string, number>>): string[] {
  const table = standings(totals);
  if (table.length === 0) return [];
  const top = table[0]!.points;
  return table.filter((s) => s.points === top).map((s) => s.id);
}

/**
 * Se termina la partida al cerrar esta ronda?
 *
 * Gana el primero que alcanza el limite. Si varios lo superan en la misma
 * ronda, gana el de mas puntos; si justo empatan arriba, se juega otra ronda.
 * El tope de rondas corta partidas que no avanzan (y ahi si puede haber empate).
 */
export function matchIsOver(
  totals: Readonly<Record<string, number>>,
  target: number,
  round: number,
  maxRounds: number = SCORING.maxRounds,
): boolean {
  if (round >= maxRounds) return true;
  const reached = Object.values(totals).filter((p) => p >= target);
  if (reached.length === 0) return false;
  return winners(totals).length === 1;
}
