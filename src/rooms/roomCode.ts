/**
 * Codigos de sala de 4 caracteres.
 * El alfabeto excluye I, L, O, 0 y 1 para que nadie dicte mal un codigo.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/**
 * Normaliza lo que escribe el usuario: mayusculas, sin espacios y traduciendo
 * los errores tipicos al dictar un codigo (el cero por la O, el uno por la I).
 */
export function normalizeCode(raw: string): string {
  const upper = raw.toUpperCase().replace(/\s/g, '');
  return [...upper]
    .map((c) => {
      if (c === '0' || c === 'O') return 'Q';
      if (c === '1' || c === 'I' || c === 'L') return 'J';
      return c;
    })
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}
