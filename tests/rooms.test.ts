import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, isValidCode, normalizeCode } from '../src/rooms/roomCode';
import { COLOR_COUNT, firstFreeColor } from '../src/rooms/colors';
import { electHost, shouldClaimHost } from '../src/rooms/hostElection';
import type { Room, RoomPlayer } from '../src/rooms/types';

describe('codigo de sala', () => {
  it('el alfabeto no tiene caracteres ambiguos', () => {
    for (const c of ['I', 'L', 'O', '0', '1']) {
      expect(CODE_ALPHABET.includes(c)).toBe(false);
    }
  });

  it('normaliza mayusculas y espacios', () => {
    expect(normalizeCode(' k7p2 ')).toBe('K7P2');
  });

  it('traduce los errores tipicos al dictar', () => {
    // Cero y O suenan igual; uno, I y L tambien.
    expect(normalizeCode('0K1M')).toBe('QKJM');
    expect(normalizeCode('OKLM')).toBe('QKJM');
  });

  it('corta a 4 caracteres y descarta simbolos', () => {
    expect(normalizeCode('K7-P2XYZ')).toBe('K7P2');
    expect(isValidCode('K7P2')).toBe(true);
    expect(isValidCode('K7P')).toBe(false);
  });
});

describe('colores', () => {
  it('hay 9 colores', () => {
    expect(COLOR_COUNT).toBe(9);
  });

  it('devuelve el primer hueco libre', () => {
    expect(firstFreeColor([0, 1, 3])).toBe(2);
    expect(firstFreeColor([])).toBe(0);
  });

  it('devuelve -1 cuando no queda ninguno', () => {
    expect(firstFreeColor([0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe(-1);
  });
});

describe('eleccion de host', () => {
  const players: RoomPlayer[] = [
    { userId: 'a', name: 'A', color: 0, role: 'player', joinOrder: 1, score: 0 },
    { userId: 'b', name: 'B', color: 1, role: 'player', joinOrder: 2, score: 0 },
    { userId: 'c', name: 'C', color: 2, role: 'player', joinOrder: 3, score: 0 },
  ];
  const room: Room = {
    id: 'r',
    code: 'K7P2',
    hostId: 'a',
    mapId: 'ASCENSO',
    targetPoints: 2000,
    roundSeconds: 60,
    status: 'lobby',
  };

  it('gana el conectado con menor join_order', () => {
    expect(electHost(players, new Set(['b', 'c']))).toBe('b');
    expect(electHost(players, new Set(['c']))).toBe('c');
  });

  it('sin nadie conectado no hay host', () => {
    expect(electHost(players, new Set())).toBe(null);
  });

  it('todos los clientes eligen el mismo sucesor', () => {
    const connected = new Set(['c', 'b']);
    const shuffled = [...players].reverse();
    expect(electHost(shuffled, connected)).toBe(electHost(players, connected));
  });

  it('solo el sucesor electo reclama el host', () => {
    const connected = new Set(['b', 'c']);
    expect(shouldClaimHost(room, players, connected, 'b')).toBe(true);
    expect(shouldClaimHost(room, players, connected, 'c')).toBe(false);
  });

  it('nadie reclama mientras el host siga conectado', () => {
    const connected = new Set(['a', 'b', 'c']);
    expect(shouldClaimHost(room, players, connected, 'b')).toBe(false);
  });

  it('el host no se reclama a si mismo', () => {
    expect(shouldClaimHost(room, players, new Set(['a']), 'a')).toBe(false);
  });
});

describe('mapId en la configuracion de sala', () => {
  it('mapRoom conserva el map_id que viene de la base', async () => {
    const { mapRoom } = await import('../src/rooms/roomsApi');
    const room = mapRoom({
      id: 'r',
      code: 'K7P2',
      host_id: 'a',
      map_id: 'TEST_MAP',
      target_points: 2000,
      round_seconds: 60,
      status: 'lobby',
    });
    expect(room.mapId).toBe('TEST_MAP');
  });

  it('compatibilidad: una fila vieja sin map_id cae en ASCENSO, no rompe la sala (§13)', async () => {
    const { mapRoom } = await import('../src/rooms/roomsApi');
    const { DEFAULT_MAP_ID } = await import('../src/core/maps/registry');
    // Simula una fila de una sala creada antes de que existiera la columna.
    const row = {
      id: 'r',
      code: 'K7P2',
      host_id: 'a',
      target_points: 2000,
      round_seconds: 60,
      status: 'lobby',
    } as Parameters<typeof mapRoom>[0];
    expect(mapRoom(row).mapId).toBe(DEFAULT_MAP_ID);
  });
});
