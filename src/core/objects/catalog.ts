import type { Hazard, PlacedObject, Solid } from '../types';

/**
 * CATALOGO DE OBJETOS
 *
 * Todo lo que los jugadores pueden agregar al mapa se define aca: forma,
 * comportamiento fisico y color. Nada de esto esta cableado en la simulacion;
 * la fisica solo entiende de solidos, plataformas de una via, peligros,
 * rozamiento e impulso, y cada objeto se arma combinando esas piezas.
 *
 * Son disenos propios de PIXEL RUMBLE: formas geometricas simples con nombres
 * y comportamientos pensados para este juego (§14).
 */

export type ObjectCategory = 'plataforma' | 'trampa' | 'obstaculo' | 'movilidad' | 'superficie';

export interface ObjectPart {
  dx: number;
  dy: number;
  w: number;
  h: number;
  kind: 'solid' | 'oneWay' | 'hazard';
  friction?: number;
  bounce?: number;
}

export interface ObjectType {
  id: string;
  name: string;
  /** Que hace, en una linea, para mostrarlo al elegir. */
  hint: string;
  category: ObjectCategory;
  w: number;
  h: number;
  /** Si se puede girar 90 grados al colocarlo. */
  rotatable: boolean;
  parts: ObjectPart[];
  color: number;
  accent: number;
}

const define = (t: ObjectType): ObjectType => t;

export const OBJECT_TYPES: ObjectType[] = [
  define({
    id: 'tabla',
    name: 'TABLA',
    hint: 'Plataforma corta',
    category: 'plataforma',
    w: 28,
    h: 6,
    rotatable: true,
    parts: [{ dx: 0, dy: 0, w: 28, h: 6, kind: 'solid' }],
    color: 0x8a6a3f,
    accent: 0xc9a063,
  }),
  define({
    id: 'viga',
    name: 'VIGA',
    hint: 'Plataforma larga',
    category: 'plataforma',
    w: 46,
    h: 6,
    rotatable: true,
    parts: [{ dx: 0, dy: 0, w: 46, h: 6, kind: 'solid' }],
    color: 0x6d5a8a,
    accent: 0xa98fd0,
  }),
  define({
    id: 'nube',
    name: 'NUBE',
    hint: 'Se atraviesa desde abajo',
    category: 'plataforma',
    w: 26,
    h: 5,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 26, h: 5, kind: 'oneWay' }],
    color: 0x5a7fb5,
    accent: 0x9dc4f0,
  }),
  define({
    id: 'pinchos',
    name: 'PINCHOS',
    hint: 'Mata al tocarlos',
    category: 'trampa',
    w: 18,
    h: 6,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 18, h: 6, kind: 'hazard' }],
    color: 0xe4515b,
    accent: 0xff9aa2,
  }),
  define({
    id: 'estaca',
    name: 'ESTACA',
    hint: 'Pincho alto, mortal',
    category: 'trampa',
    w: 6,
    h: 22,
    rotatable: true,
    parts: [{ dx: 0, dy: 0, w: 6, h: 22, kind: 'hazard' }],
    color: 0xc23b52,
    accent: 0xff8a93,
  }),
  define({
    id: 'bloque',
    name: 'BLOQUE',
    hint: 'Estorba el paso',
    category: 'obstaculo',
    w: 16,
    h: 16,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 16, h: 16, kind: 'solid' }],
    color: 0x4a5578,
    accent: 0x8895c9,
  }),
  define({
    id: 'columna',
    name: 'COLUMNA',
    hint: 'Muro alto y finito',
    category: 'obstaculo',
    w: 8,
    h: 36,
    rotatable: true,
    parts: [{ dx: 0, dy: 0, w: 8, h: 36, kind: 'solid' }],
    color: 0x3f4a6b,
    accent: 0x7d8ac0,
  }),
  define({
    id: 'resorte',
    name: 'RESORTE',
    hint: 'Te lanza muy alto',
    category: 'movilidad',
    w: 16,
    h: 6,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 16, h: 6, kind: 'solid', bounce: 360 }],
    color: 0x2f9e5a,
    accent: 0x7ef0a8,
  }),
  define({
    id: 'hielo',
    name: 'HIELO',
    hint: 'Resbala muchísimo',
    category: 'superficie',
    w: 34,
    h: 6,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 34, h: 6, kind: 'solid', friction: 0.12 }],
    color: 0x4aa8c9,
    accent: 0xa8ecff,
  }),
  define({
    id: 'brea',
    name: 'BREA',
    hint: 'Te frena en seco',
    category: 'superficie',
    w: 30,
    h: 6,
    rotatable: false,
    parts: [{ dx: 0, dy: 0, w: 30, h: 6, kind: 'solid', friction: 3.5 }],
    color: 0x3a2f46,
    accent: 0x6b5a80,
  }),
];

const BY_ID = new Map(OBJECT_TYPES.map((t) => [t.id, t]));

export function objectType(id: string): ObjectType | undefined {
  return BY_ID.get(id);
}

/** Tamano que ocupa segun su rotacion. */
export function objectSize(type: ObjectType, rotation: 0 | 1): { w: number; h: number } {
  return rotation === 1 && type.rotatable
    ? { w: type.h, h: type.w }
    : { w: type.w, h: type.h };
}

/** Las piezas de un objeto, ya ubicadas en el mapa. */
export function objectParts(
  placed: PlacedObject,
): { part: ObjectPart; x: number; y: number; w: number; h: number }[] {
  const type = BY_ID.get(placed.type);
  if (!type) return [];
  const rotated = placed.rotation === 1 && type.rotatable;

  return type.parts.map((part) => {
    // Giro de 90 grados alrededor de la esquina del objeto.
    const x = placed.x + (rotated ? type.h - part.dy - part.h : part.dx);
    const y = placed.y + (rotated ? part.dx : part.dy);
    const w = rotated ? part.h : part.w;
    const h = rotated ? part.w : part.h;
    return { part, x, y, w, h };
  });
}

/**
 * Convierte los objetos colocados en geometria para la fisica.
 *
 * Cada peligro se lleva puesto el id de su dueno: eso es lo que permite darle
 * los puntos cuando su trampa elimina a alguien, incluso rondas mas tarde.
 */
export function objectsToGeometry(objects: readonly PlacedObject[]): {
  solids: Solid[];
  hazards: Hazard[];
} {
  const solids: Solid[] = [];
  const hazards: Hazard[] = [];

  for (const placed of objects) {
    for (const { part, x, y, w, h } of objectParts(placed)) {
      if (part.kind === 'hazard') {
        hazards.push({ x, y, w, h, ownerId: placed.ownerId });
      } else {
        solids.push({
          x,
          y,
          w,
          h,
          oneWay: part.kind === 'oneWay',
          friction: part.friction,
          bounce: part.bounce,
          ownerId: placed.ownerId,
        });
      }
    }
  }

  return { solids, hazards };
}
