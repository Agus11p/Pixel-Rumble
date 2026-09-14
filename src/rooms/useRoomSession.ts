import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomChannel } from './RoomChannel';
import { claimHost, fetchPlayers, fetchRoom, heartbeatHost } from './roomsApi';
import { shouldClaimHost } from './hostElection';
import type { Room, RoomPlayer } from './types';

const HEARTBEAT_MS = 5000;

export interface RoomSession {
  room: Room | null;
  players: RoomPlayer[];
  connected: Set<string>;
  me: RoomPlayer | null;
  isHost: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Estado vivo de una sala.
 *
 * Regla: la base es la fuente de verdad y el canal solo avisa que hay que
 * releer. Es una request de mas por evento, pero el lobby es de baja frecuencia
 * y a cambio es imposible que dos clientes terminen viendo listas distintas.
 */
export function useRoomSession(roomId: string | null, userId: string | null): RoomSession {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const alive = useRef(true);
  /** Si ya se cargo la sala alguna vez, un error pasajero no la tapa. */
  const loadedOnce = useRef(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Suscripcion al canal: una sola vez por sala.
  useEffect(() => {
    if (!roomId || !userId) return;
    const channel = new RoomChannel(roomId, userId, {
      onChange: refresh,
      onPresence: (ids) => {
        if (alive.current) setConnected(ids);
      },
    });
    void channel.subscribe().catch((e: Error) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      void channel.unsubscribe();
    };
  }, [roomId, userId, refresh]);

  // Lectura del estado cada vez que algo cambia.
  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setPlayers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [r, p] = await Promise.all([fetchRoom(roomId), fetchPlayers(roomId)]);
        if (cancelled || !alive.current) return;
        setRoom(r);
        setPlayers(p);
        setError(null);
        loadedOnce.current = true;
      } catch (e) {
        if (cancelled || !alive.current) return;
        if (loadedOnce.current) {
          // Se mantiene lo ultimo que se sabia y se reintenta en un rato.
          setTimeout(refresh, 1500);
        } else {
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled && alive.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, version, refresh]);

  const isHost = Boolean(room && userId && room.hostId === userId);

  // Latido del host: deja rastro en la base de que sigue vivo, para que la
  // transferencia funcione incluso si el navegador se cierra de golpe.
  useEffect(() => {
    if (!roomId || !isHost) return;
    void heartbeatHost(roomId);
    const id = setInterval(() => void heartbeatHost(roomId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [roomId, isHost]);

  // Transferencia de host: solo el sucesor electo intenta reclamar.
  useEffect(() => {
    if (!room || !userId || !roomId) return;
    if (connected.size === 0) return;
    if (!shouldClaimHost(room, players, connected, userId)) return;

    const id = setTimeout(() => {
      void claimHost(roomId)
        .then((ok) => {
          if (ok) refresh();
        })
        .catch(() => {
          /* otro lo reclamo primero: no es un error */
        });
    }, 1200); // margen para no reaccionar a un parpadeo de red
    return () => clearTimeout(id);
  }, [room, players, connected, userId, roomId, refresh]);

  const me = useMemo(
    () => players.find((p) => p.userId === userId) ?? null,
    [players, userId],
  );

  return { room, players, connected, me, isHost, loading, error, refresh };
}
