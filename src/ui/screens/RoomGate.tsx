import type { JSX } from 'react';
import { Suspense, lazy } from 'react';
import { leaveRoom } from '../../rooms/roomsApi';
import { useRoomSession } from '../../rooms/useRoomSession';
import { useAppStore } from '../../store/appStore';
import { LobbyScreen } from './LobbyScreen';

/** El motor de render solo se descarga cuando arranca una carrera. */
const MatchScreen = lazy(() =>
  import('./MatchScreen').then((m) => ({ default: m.MatchScreen })),
);

/**
 * Punto unico de conexion con la sala.
 *
 * Se suscribe una sola vez y decide que mostrar segun el estado de la sala en
 * la base: lobby o carrera. Que la transicion la dispare la base y no un
 * mensaje suelto evita el caso feo de que uno entre a la partida y otro se
 * quede mirando el lobby.
 */
export function RoomGate(): JSX.Element {
  const { roomId, userId, exitRoom } = useAppStore();
  const session = useRoomSession(roomId, userId);

  async function leave(): Promise<void> {
    if (roomId) await leaveRoom(roomId).catch(() => undefined);
    exitRoom();
  }

  if (session.loading) {
    return (
      <div className="app-shell">
        <div className="screen">
          <p className="note">Cargando sala…</p>
        </div>
      </div>
    );
  }

  if (session.error || !session.room) {
    return (
      <div className="app-shell">
        <div className="screen">
          <p className="error">{session.error ?? 'La sala ya no existe.'}</p>
          <button className="btn" onClick={() => void leave()}>
            VOLVER
          </button>
        </div>
      </div>
    );
  }

  if (session.room.status === 'in_match' && roomId && userId) {
    return (
      <Suspense
        fallback={
          <div className="app-shell">
            <p className="note">Cargando carrera…</p>
          </div>
        }
      >
        <MatchScreen
          room={session.room}
          players={session.players}
          userId={userId}
          connected={session.connected}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <LobbyScreen session={session} userId={userId} onLeave={() => void leave()} />
    </div>
  );
}
