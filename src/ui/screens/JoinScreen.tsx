import { useState } from 'react';
import { ERROR_MESSAGES, RoomError, joinRoom } from '../../rooms/roomsApi';
import { CODE_LENGTH, isValidCode, normalizeCode } from '../../rooms/roomCode';
import { useAppStore } from '../../store/appStore';
import type { JSX } from 'react';

export function JoinScreen(): JSX.Element {
  const { playerName, setScreen, enterRoom } = useAppStore();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await joinRoom({ code, name: playerName.trim(), password });
      enterRoom(roomId);
    } catch (e) {
      if (e instanceof RoomError && e.code === 'BAD_PASSWORD') setNeedsPassword(true);
      setError(e instanceof RoomError ? ERROR_MESSAGES[e.code] : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h2 className="screen-title-text">UNIRSE A SALA</h2>

      <label className="field">
        <span className="field-label">CÓDIGO DE SALA</span>
        <input
          className="input input-code"
          value={code}
          placeholder="────"
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          maxLength={CODE_LENGTH}
        />
      </label>

      {needsPassword && (
        <label className="field">
          <span className="field-label">CONTRASEÑA</span>
          <input
            className="input"
            value={password}
            maxLength={24}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <div className="menu menu-row">
        <button className="btn btn-ghost" onClick={() => setScreen('title')} disabled={busy}>
          VOLVER
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void join()}
          disabled={busy || !isValidCode(code)}
        >
          {busy ? 'ENTRANDO…' : 'ENTRAR'}
        </button>
      </div>
    </div>
  );
}
