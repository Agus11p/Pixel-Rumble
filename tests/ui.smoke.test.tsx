import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/ui/App';
import { isSupabaseConfigured } from '../src/rooms/supabase';
import { SetupScreen } from '../src/ui/screens/SetupScreen';
import { LobbyScreen } from '../src/ui/screens/LobbyScreen';
import type { RoomSession } from '../src/rooms/useRoomSession';

/**
 * Smoke test de la UI: comprueba que el arbol de pantallas monta de verdad.
 * No reemplaza probarlo a mano, pero atrapa imports rotos y errores de render
 * sin abrir un navegador.
 *
 * Nota: en render de servidor zustand devuelve el estado INICIAL, asi que las
 * pantallas que dependen de navegacion se prueban montandolas directamente.
 */
describe('UI', () => {
  it('el titulo ofrece solo lo que realmente funciona', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('PIXEL');
    expect(html).toContain('RUMBLE');
    expect(html).toContain('PRUEBA LOCAL');
    // El menu online aparece si y solo si hay backend detras (§45).
    expect(html.includes('CREAR SALA')).toBe(isSupabaseConfigured);
  });

  it('la pantalla de configuración dice exactamente qué falta', () => {
    const html = renderToStaticMarkup(<SetupScreen />);
    expect(html).toContain('FALTA CONFIGURAR SUPABASE');
    expect(html).toContain('VITE_SUPABASE_URL');
    expect(html).toContain('0001_init.sql');
  });

  it('el lobby muestra el código, los jugadores y quién es el host', () => {
    const session: RoomSession = {
      room: {
        id: 'r1',
        code: 'K7P2',
        hostId: 'u1',
        targetPoints: 2000,
        roundSeconds: 60,
        status: 'lobby',
      },
      players: [
        { userId: 'u1', name: 'ANA', color: 0, role: 'player', joinOrder: 1, score: 0 },
        { userId: 'u2', name: 'BETO', color: 2, role: 'player', joinOrder: 2, score: 0 },
      ],
      connected: new Set(['u1', 'u2']),
      me: { userId: 'u1', name: 'ANA', color: 0, role: 'player', joinOrder: 1, score: 0 },
      isHost: true,
      loading: false,
      error: null,
      refresh: () => undefined,
    };
    const html = renderToStaticMarkup(
      <LobbyScreen session={session} userId="u1" onLeave={() => undefined} />,
    );
    expect(html).toContain('K7P2');
    expect(html).toContain('ANA');
    expect(html).toContain('BETO');
    expect(html).toContain('HOST');
    // Con dos jugadores el host ya puede arrancar.
    expect(html).toContain('EMPEZAR');
  });
});
