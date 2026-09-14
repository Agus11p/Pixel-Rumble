import { useState } from 'react';
import { createRoom, ERROR_MESSAGES, RoomError } from '../../rooms/roomsApi';
import { SCORING } from '../../core/scoring';
import { TARGET_OPTIONS, TIME_OPTIONS } from '../../rooms/types';
import { useAppStore } from '../../store/appStore';
import { OptionRow } from '../components/OptionRow';
import type { JSX } from 'react';

export function CreateScreen(): JSX.Element {
  const { playerName, setScreen, enterRoom } = useAppStore();
  const [target, setTarget] = useState<number>(SCORING.targetDefault);
  const [seconds, setSeconds] = useState(60);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await createRoom({
        name: playerName.trim(),
        password,
        targetPoints: target,
        roundSeconds: seconds,
      });
      enterRoom(roomId);
    } catch (e) {
      setError(e instanceof RoomError ? ERROR_MESSAGES[e.code] : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h2 className="screen-title-text">CREAR SALA</h2>

      <OptionRow
        label="PUNTOS PARA GANAR"
        options={TARGET_OPTIONS}
        value={target}
        onChange={setTarget}
      />
      <OptionRow
        label="TIEMPO DE CARRERA"
        options={TIME_OPTIONS}
        value={seconds}
        onChange={setSeconds}
        suffix="s"
      />

      <label className="field">
        <span className="field-label">CONTRASEÑA (OPCIONAL)</span>
        <input
          className="input"
          value={password}
          maxLength={24}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="menu menu-row">
        <button className="btn btn-ghost" onClick={() => setScreen('title')} disabled={busy}>
          VOLVER
        </button>
        <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
          {busy ? 'CREANDO…' : 'CREAR'}
        </button>
      </div>
    </div>
  );
}
