import { OBJECT_TYPES } from './objects/catalog';
import type { ObjectCategory } from './objects/catalog';

/**
 * CHAOS BOX
 *
 * Antes de cada ronda aparece la oferta de objetos: tantos como jugadores
 * activos MAS DOS (§13), asi siempre sobran dos y nadie se queda sin nada por
 * ser el ultimo en elegir. La competencia es por el objeto bueno, no por tener
 * uno.
 *
 * La oferta se genera con una semilla que manda el host, y como el generador
 * es determinista todos los clientes arman exactamente la misma lista sin que
 * haya que transmitirla. Ademas se equilibra por categorias: nunca salen solo
 * trampas ni solo plataformas (§13).
 */

export interface Offer {
  /** Identificador de la oferta dentro de la ronda. */
  id: number;
  type: string;
  /** Quien se lo quedo, o null si sigue libre. */
  takenBy: string | null;
}

/** Generador determinista y reproducible (mulberry32). */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cuantos objetos se ofrecen segun cuantos jueguen. */
export function offerCount(playerCount: number): number {
  return playerCount + 2;
}

/** Como maximo dos objetos de la misma categoria en una oferta. */
const MAX_PER_CATEGORY = 2;
/** Categorias que siempre tienen que aparecer, para que la ronda sea jugable. */
const GUARANTEED: ObjectCategory[] = ['plataforma', 'trampa'];

export function generateOffers(seed: number, count: number): Offer[] {
  const random = makeRandom(seed);
  const pickFrom = (pool: typeof OBJECT_TYPES): string =>
    pool[Math.floor(random() * pool.length)]!.id;

  const chosen: string[] = [];
  const perCategory = new Map<ObjectCategory, number>();
  const countFor = (c: ObjectCategory): number => perCategory.get(c) ?? 0;

  const take = (id: string): void => {
    const type = OBJECT_TYPES.find((t) => t.id === id)!;
    chosen.push(id);
    perCategory.set(type.category, countFor(type.category) + 1);
  };

  // Primero lo que no puede faltar.
  for (const category of GUARANTEED) {
    if (chosen.length >= count) break;
    take(pickFrom(OBJECT_TYPES.filter((t) => t.category === category)));
  }

  // El resto al azar, respetando el tope por categoria y sin repetir tipo.
  let guard = 0;
  while (chosen.length < count && guard++ < 200) {
    const pool = OBJECT_TYPES.filter(
      (t) => countFor(t.category) < MAX_PER_CATEGORY && !chosen.includes(t.id),
    );
    if (pool.length === 0) break;
    take(pickFrom(pool));
  }

  // Si el catalogo se queda corto, se completa con lo que haya.
  while (chosen.length < count) {
    take(pickFrom(OBJECT_TYPES));
  }

  // Barajado determinista para que el orden en pantalla tambien sorprenda.
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j]!, chosen[i]!];
  }

  return chosen.map((type, id) => ({ id, type, takenBy: null }));
}
