import type { GameMap } from '../types';

/**
 * Validacion de definiciones de mapa.
 *
 * No busca geometria perfecta ni pathfinding: solo errores obvios que, si se
 * cuelan, producen un estado raro en runtime (un spawn fuera de cuadro, una
 * meta con area cero) en vez de fallar claramente al agregar el mapa. Se
 * corre sobre cada entrada del registry al cargar el modulo (ver
 * `registry.ts`), asi que un mapa mal definido rompe el build/los tests, no
 * una partida real.
 *
 * El margen de los solidos/hazards es generoso a proposito: los muros de un
 * mapa suelen extenderse mas alla del cuadro visible (para que nadie "salga
 * de cuadro" antes de morir), asi que no tiene sentido exigirles que queden
 * exactamente dentro de width x height.
 */

/** Cuanto puede sobresalir un solido/hazard del cuadro del mapa y seguir siendo razonable. */
const BOUNDS_MARGIN = 200;

export interface MapValidationIssue {
  field: string;
  message: string;
}

function checkRect(
  label: string,
  rect: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  margin: number,
  issues: MapValidationIssue[],
): void {
  if (!(rect.w > 0) || !(rect.h > 0)) {
    issues.push({ field: label, message: `${label}: el ancho y el alto tienen que ser mayores a 0` });
  }
  if (
    rect.x < -margin ||
    rect.y < -margin ||
    rect.x + rect.w > width + margin ||
    rect.y + rect.h > height + margin
  ) {
    issues.push({ field: label, message: `${label}: queda demasiado lejos del cuadro del mapa` });
  }
}

/** Lista los problemas de una definicion. Vacio = valida. */
export function validateMap(map: GameMap): MapValidationIssue[] {
  const issues: MapValidationIssue[] = [];

  if (!map.id || map.id.trim().length === 0) {
    issues.push({ field: 'id', message: 'El mapa necesita un id' });
  }
  if (!map.name || map.name.trim().length === 0) {
    issues.push({ field: 'name', message: 'El mapa necesita un nombre' });
  }
  if (!(map.width > 0)) {
    issues.push({ field: 'width', message: 'width tiene que ser mayor a 0' });
  }
  if (!(map.height > 0)) {
    issues.push({ field: 'height', message: 'height tiene que ser mayor a 0' });
  }

  if (map.spawns.length === 0) {
    issues.push({ field: 'spawns', message: 'El mapa necesita al menos un spawn' });
  }
  map.spawns.forEach((s, i) => {
    if (s.x < 0 || s.y < 0 || s.x > map.width || s.y > map.height) {
      issues.push({ field: 'spawns', message: `spawn[${i}] queda fuera del mapa` });
    }
  });

  if (map.width > 0 && map.height > 0) {
    checkRect('goal', map.goal, map.width, map.height, 0, issues);

    map.solids.forEach((s, i) =>
      checkRect(`solids[${i}]`, s, map.width, map.height, BOUNDS_MARGIN, issues),
    );
    map.hazards.forEach((h, i) =>
      checkRect(`hazards[${i}]`, h, map.width, map.height, BOUNDS_MARGIN, issues),
    );
  }

  return issues;
}

export function isValidMap(map: GameMap): boolean {
  return validateMap(map).length === 0;
}

/** Igual que `validateMap`, pero explota con un mensaje claro si algo esta mal. */
export function assertValidMap(map: GameMap): void {
  const issues = validateMap(map);
  if (issues.length === 0) return;
  const detail = issues.map((i) => `  - ${i.message}`).join('\n');
  throw new Error(`Mapa invalido "${map.id || '(sin id)'}":\n${detail}`);
}
