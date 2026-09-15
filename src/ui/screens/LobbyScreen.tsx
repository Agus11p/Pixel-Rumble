import type { JSX } from 'react';
import { useState } from 'react';
import { PLAYER_COLORS, colorHex } from '../../rooms/colors';
import { ERROR_MESSAGES, RoomError, setColor, setConfig, setMap, startMatch } from '../../rooms/roomsApi';
import type { RoomSession } from '../../rooms/useRoomSession';
import {
  MAP_LABELS,
  MAP_OPTIONS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  TARGET_OPTIONS,
  TIME_OPTIONS,
} from '../../rooms/types';
import { OptionRow } from '../components/OptionRow';

interface Props {
  session: RoomSession;
  userId: string | null;
  onLeave: () => void;
}

export function LobbyScreen({ session, userId, onLeave }: Props): JSX.Element {
  const { room, players, connected, me, isHost } = session;
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (!room) {
    return (
      <div className="screen">
        <p className="note">Cargando sala…</p>
      </div>
    );
  }

  const roomId = room.id;

  function fail(e: unknown): void {
    setActionError(e instanceof RoomError ? ERROR_MESSAGES[e.code] : (e as Error).message);
  }

  async function pickColor(index: number): Promise<void> {
    setActionError(null);
    try {
      await setColor(roomId, index);
    } catch (e) {
      fail(e);
    }
  }

  async function changeConfig(target: number, seconds: number): Promise<void> {
    setActionError(null);
    try {
      await setConfig(roomId, target, seconds);
    } catch (e) {
      fail(e);
    }
  }

  async function changeMap(nextMapId: string): Promise<void> {
    setActionError(null);
    try {
      await setMap(roomId, nextMapId);
    } catch (e) {
      fail(e);
    }
  }

  async function begin(): Promise<void> {
    setActionError(null);
    setStarting(true);
    try {
      await startMatch(roomId);
    } catch (e) {
      fail(e);
      setStarting(false);
    }
  }

  const activePlayers = players.filter((p) => p.role === 'player');
  const takenColors = activePlayers.map((p) => p.color);
  const spectators = players.filter((p) => p.role === 'spectator');
  const canStart = activePlayers.length >= MIN_PLAYERS_TO_START;

  return (
    <div className="screen screen-lobby">
      <div className="lobby-head">
        <div>
          <span className="field-label">CÓDIGO DE SALA</span>
          <div className="room-code">{room.code}</div>
        </div>
        <div className="lobby-count">
          {activePlayers.length}/{MAX_PLAYERS}
          <span className="field-label">JUGADORES</span>
        </div>
      </div>

      <ul className="player-list">
        {players.map((p) => (
          <li key={p.userId} className={`player-row ${connected.has(p.userId) ? '' : 'offline'}`}>
            <span className="player-dot" style={{ background: colorHex(p.color) }} />
            <span className="player-name">
              {p.name}
              {p.userId === userId && <em> (VOS)</em>}
            </span>
            {p.role === 'spectator' && <span className="tag">ESPECTADOR</span>}
            {room.hostId === p.userId && <span className="tag tag-host">HOST</span>}
            {!connected.has(p.userId) && <span className="tag tag-off">SIN CONEXIÓN</span>}
          </li>
        ))}
      </ul>

      {me?.role === 'player' && (
        <div className="option-row">
          <span className="field-label">TU COLOR</span>
          <div className="color-grid">
            {PLAYER_COLORS.map((c, i) => {
              const taken = takenColors.includes(i) && me.color !== i;
              return (
                <button
                  key={c.name}
                  className={`color-chip ${me.color === i ? 'selected' : ''} ${taken ? 'taken' : ''}`}
                  style={{ background: c.hex }}
                  title={taken ? `${c.name} (ocupado)` : c.name}
                  disabled={taken}
                  onClick={() => void pickColor(i)}
                />
              );
            })}
          </div>
        </div>
      )}

      <OptionRow
        label="MAPA"
        options={MAP_OPTIONS}
        value={room.mapId}
        disabled={!isHost}
        onChange={(m) => void changeMap(m)}
        formatOption={(id) => MAP_LABELS[id] ?? id}
      />
      <OptionRow
        label="PUNTOS PARA GANAR"
        options={TARGET_OPTIONS}
        value={room.targetPoints}
        disabled={!isHost}
        onChange={(t) => void changeConfig(t, room.roundSeconds)}
      />
      <OptionRow
        label="TIEMPO DE CARRERA"
        options={TIME_OPTIONS}
        value={room.roundSeconds}
        suffix="s"
        disabled={!isHost}
        onChange={(s) => void changeConfig(room.targetPoints, s)}
      />

      {actionError && <p className="error">{actionError}</p>}

      {spectators.length > 0 && (
        <p className="note">{spectators.length} en espera: entran cuando se libere un lugar.</p>
      )}

      <div className="menu menu-row">
        <button className="btn btn-ghost" onClick={onLeave}>
          SALIR
        </button>
        {isHost ? (
          <button
            className="btn btn-primary"
            onClick={() => void begin()}
            disabled={!canStart || starting}
          >
            {starting ? 'EMPEZANDO…' : 'EMPEZAR'}
          </button>
        ) : (
          <span className="note">Esperando al host…</span>
        )}
      </div>

      {!canStart && <p className="note note-pending">Faltan jugadores para poder empezar.</p>}
    </div>
  );
}
