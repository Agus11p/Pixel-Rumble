import { Suspense, lazy, useEffect } from 'react';
import { ensureSession } from '../rooms/auth';
import { isSupabaseConfigured } from '../rooms/supabase';
import { useAppStore } from '../store/appStore';
import { CreateScreen } from './screens/CreateScreen';
import { JoinScreen } from './screens/JoinScreen';
import { RoomGate } from './screens/RoomGate';
import { SetupScreen } from './screens/SetupScreen';

/**
 * El juego (PixiJS) se carga solo cuando hace falta: el menu y el lobby no
 * tienen por que arrastrar el motor de render en la primera descarga.
 */
const LocalGameScreen = lazy(() =>
  import('./screens/LocalGameScreen').then((m) => ({ default: m.LocalGameScreen })),
);
import { TitleScreen } from './screens/TitleScreen';
import type { JSX } from 'react';

export function App(): JSX.Element {
  const { screen, setUserId, setAuthError, authError } = useAppStore();

  // Sesion anonima al arrancar: sin formularios, sin email, sin friccion (§33).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void ensureSession()
      .then(setUserId)
      .catch((e: Error) => setAuthError(e.message));
  }, [setUserId, setAuthError]);

  if (screen === 'local') {
    return (
      <Suspense fallback={<div className="app-shell"><p className="note">Cargando juego…</p></div>}>
        <LocalGameScreen />
      </Suspense>
    );
  }
  if (!isSupabaseConfigured && screen !== 'title') return <SetupScreen />;

  if (screen === 'lobby') return <RoomGate />;

  return (
    <div className="app-shell">
      {authError && <p className="error error-banner">{authError}</p>}
      {screen === 'title' && (isSupabaseConfigured ? <TitleScreen /> : <OfflineTitle />)}
      {screen === 'create' && <CreateScreen />}
      {screen === 'join' && <JoinScreen />}
    </div>
  );
}

/** Titulo cuando no hay backend: solo se ofrece lo que realmente funciona. */
function OfflineTitle(): JSX.Element {
  const setScreen = useAppStore((s) => s.setScreen);
  return (
    <div className="screen screen-title">
      <h1 className="logo">
        <span className="logo-pixel">PIXEL</span>
        <span className="logo-rumble">RUMBLE</span>
      </h1>
      <div className="menu">
        <button className="btn btn-primary" onClick={() => setScreen('local')}>
          PRUEBA LOCAL
        </button>
      </div>
      <p className="note">El modo online necesita configurar Supabase.</p>
    </div>
  );
}
