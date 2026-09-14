/** Los 9 colores de jugador. El indice es lo que se guarda en la base. */
export const PLAYER_COLORS = [
  { name: 'NARANJA', hex: '#ffb03b' },
  { name: 'CIAN', hex: '#4ed4e8' },
  { name: 'VERDE', hex: '#53e07a' },
  { name: 'ROSA', hex: '#ff6fa5' },
  { name: 'VIOLETA', hex: '#a584e8' },
  { name: 'ROJO', hex: '#e4515b' },
  { name: 'AMARILLO', hex: '#f5e14b' },
  { name: 'AZUL', hex: '#5b8cff' },
  { name: 'MENTA', hex: '#7ef0c8' },
] as const;

export const COLOR_COUNT = PLAYER_COLORS.length;

export function colorHex(index: number): string {
  return PLAYER_COLORS[index]?.hex ?? '#7b86b3';
}

export function colorName(index: number): string {
  return PLAYER_COLORS[index]?.name ?? 'ESPECTADOR';
}

/** Primer color libre. Devuelve -1 si no queda ninguno. */
export function firstFreeColor(taken: readonly number[]): number {
  for (let i = 0; i < COLOR_COUNT; i++) {
    if (!taken.includes(i)) return i;
  }
  return -1;
}
