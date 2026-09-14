import { useAppStore } from '../../store/appStore';
import type { JSX } from 'react';

const MAX_NAME = 16;

export function TitleScreen(): JSX.Element {
  const { playerName, setPlayerName, setScreen, userId } = useAppStore();
  const ready = playerName.trim().length > 0 && Boolean(userId);

  return (
    <div className="screen screen-title">
      <h1 className="logo">
        <span className="logo-pixel">PIXEL</span>
        <span className="logo-rumble">RUMBLE</span>
      </h1>

      <label className="field">
        <span className="field-label">TU NOMBRE</span>
        <input
          className="input"
          value={playerName}
          maxLength={MAX_NAME}
          placeholder="JUGADOR"
          onChange={(e) => setPlayerName(e.target.value.slice(0, MAX_NAME))}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="menu">
        <button className="btn btn-primary" disabled={!ready} onClick={() => setScreen('create')}>
          CREAR SALA
        </button>
        <button className="btn" disabled={!ready} onClick={() => setScreen('join')}>
          UNIRSE A SALA
        </button>
        <button className="btn btn-ghost" onClick={() => setScreen('local')}>
          PRUEBA LOCAL
        </button>
      </div>

      {!userId && <p className="note">Conectando…</p>}
    </div>
  );
}
