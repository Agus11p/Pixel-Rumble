import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TICK_RATE, VIRTUAL_H, VIRTUAL_W } from '../../core/constants';
import { isValidMapId } from '../../core/maps/registry';
import { objectType } from '../../core/objects/catalog';
import { snapPlacement } from '../../core/objects/placement';
import { scoreRound, standings, totalsBeforeRound, winners } from '../../core/scoring';
import type { ScoreReason } from '../../core/scoring';
import { Game } from '../../game/Game';
import { OnlineDriver } from '../../game/drivers';
import type { PlayerSkin } from '../../game/render/WorldRenderer';
import { MatchSession } from '../../net/MatchSession';
import type { MatchSnapshotState } from '../../net/MatchSession';
import { colorHex } from '../../rooms/colors';
import { endMatch, promoteSpectators } from '../../rooms/roomsApi';
import type { Room, RoomPlayer } from '../../rooms/types';
import { ChaosBoxPanel } from './ChaosBoxPanel';

/** Pixeles del mapa que el objeto sube por encima del dedo en pantallas tactiles. */
const TOUCH_LIFT = 22;

interface Props {
  room: Room;
  players: RoomPlayer[];
  userId: string;
  /** Presencia en vivo de la sala (Supabase Presence, via useRoomSession). */
  connected: Set<string>;
}

const INITIAL: MatchSnapshotState = {
  phase: 'idle',
  roster: [],
  round: 0,
  targetPoints: 0,
  countdown: 0,
  timeLeft: 0,
  nextIn: 0,
  roundResult: null,
  phaseLeft: 0,
  offers: [],
  myOffer: null,
  myObjectPlaced: false,
  objects: [],
  ghosts: [],
  totals: {},
  stats: {},
  ready: false,
  ping: 0,
  rollbacks: 0,
};

/**
 * La partida online: rondas, puntos y final.
 *
 * El canvas lo maneja el motor; todo lo que se ve encima es DOM. A 480x270 un
 * texto dibujado dentro del canvas seria ilegible, y ademas asi la interfaz se
 * adapta al tamano de pantalla sin tocar el juego.
 */
export function MatchScreen({ room, players, userId, connected }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<MatchSession | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [state, setState] = useState<MatchSnapshotState>(INITIAL);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<0 | 1>(0);
  /**
   * En PC el fantasma sigue al mouse hasta que hacés click; ahí queda fijado y
   * el mouse deja de moverlo, para poder ir tranquilo hasta CONFIRMAR.
   * En tactil se arrastra y queda fijado al levantar el dedo.
   */
  const [anchored, setAnchored] = useState(false);
  const ghostPos = useRef({ x: VIRTUAL_W / 2, y: VIRTUAL_H / 2 });

  const isHost = room.hostId === userId;

  // Orden fijo de jugadores: el mismo en todos los clientes, porque define las
  // posiciones de salida y el orden de simulacion.
  const racers = useMemo(
    () => players.filter((p) => p.role === 'player').sort((a, b) => a.joinOrder - b.joinOrder),
    [players],
  );
  const byId = useMemo(() => new Map(players.map((p) => [p.userId, p])), [players]);

  // La sesion consulta la lista en cada ronda, asi que tiene que ver siempre
  // la ultima version sin que eso reinicie la partida.
  const rosterRef = useRef<string[]>([]);
  rosterRef.current = racers.map((p) => p.userId);

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    // El mapa lo fija la sala (§9): si por lo que sea no esta registrado en
    // este cliente (una sala vieja, un id con typo, una version desalineada),
    // se avisa con un error claro y NO se arranca la partida, en vez de
    // reventar a mitad de construir la sesion.
    if (!isValidMapId(room.mapId)) {
      setError(`Mapa desconocido: "${room.mapId}". Actualizá la página e intentá de nuevo.`);
      return;
    }

    const session = new MatchSession({
      roomId: room.id,
      userId,
      isHost,
      mapId: room.mapId,
      targetPoints: room.targetPoints,
      roundSeconds: room.roundSeconds,
      // Si justo la lista viene vacia (una recarga a medias), se mantiene la
      // de la ronda anterior en vez de dejar a todos afuera.
      getRoster: () =>
        rosterRef.current.length > 0
          ? [...rosterRef.current]
          : (sessionRef.current?.currentRoster ?? [userId]),
      onRoundEnd: () => {
        // Entre rondas entran los que estaban esperando (§10).
        void promoteSpectators(room.id).catch(() => undefined);
      },
      onState: setState,
    });
    sessionRef.current = session;

    const game = new Game({ driver: new OnlineDriver(session), hud: false });
    gameRef.current = game;
    let cancelled = false;

    void (async () => {
      try {
        await session.start();
        if (cancelled) return;
        await game.start(parent);
        if (cancelled) {
          game.destroy();
          return;
        }
        if (isHost) session.beginMatch();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      game.destroy();
      gameRef.current = null;
      void session.destroy();
      sessionRef.current = null;
    };
    // La sesion se crea una vez por partida: que entre o salga gente no la reinicia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // El host de la sala puede cambiar en medio de la partida (el mecanismo de
  // eleccion ya existe en useRoomSession/hostElection y sigue funcionando
  // durante la carrera). Cuando eso pasa, la sesion lo asume sin reiniciar
  // nada: no crea un MatchSession nuevo, no recrea el canvas ni el mundo.
  useEffect(() => {
    sessionRef.current?.setHost(room.hostId === userId);
  }, [room.hostId, userId]);

  // Presencia en vivo: el host la usa para detectar jugadores desconectados
  // durante la carrera (§24). En los demas clientes no tiene efecto.
  useEffect(() => {
    sessionRef.current?.setConnected(connected);
  }, [connected]);

  // Los colores se refrescan aparte, sin tocar la simulacion.
  useEffect(() => {
    const skins = new Map<string, PlayerSkin>(
      racers.map((p) => [
        p.userId,
        { color: Number.parseInt(colorHex(p.color).slice(1), 16), local: p.userId === userId },
      ]),
    );
    gameRef.current?.setSkins(skins);
  }, [racers, userId]);

  // Los fantasmas se mandan al motor, que los dibuja dentro del canvas.
  useEffect(() => {
    gameRef.current?.setGhosts(
      state.ghosts.map((g) => ({
        type: g.type,
        x: g.x,
        y: g.y,
        rotation: g.rotation,
        valid: g.valid,
        own: g.userId === userId,
        anchored: g.userId === userId && anchored,
      })),
    );
  }, [state.ghosts, userId, anchored]);

  // Cada ronda empieza de cero: sin fijar y sin girar.
  useEffect(() => {
    if (state.phase === 'placement') {
      setAnchored(false);
      setRotation(0);
    }
  }, [state.phase]);

  // Lista de objetos siempre actualizada, sin rehacer los handlers.
  const objectsRef = useRef(state.objects);
  objectsRef.current = state.objects;

  /**
   * Traduce donde toca el dedo o el mouse a coordenadas del mapa.
   * @param lift cuanto subir el objeto por encima del dedo, para que se vea.
   */
  const moveGhost = useCallback(
    (clientX: number, clientY: number, lift = 0): void => {
      const session = sessionRef.current;
      const rect = gameRef.current?.canvasRect();
      if (!session || !rect || rect.width === 0) return;
      const offer = session.myOffer;
      if (!offer || !objectType(offer.type)) return;

      const vx = ((clientX - rect.left) / rect.width) * VIRTUAL_W;
      const vy = ((clientY - rect.top) / rect.height) * VIRTUAL_H - lift;
      const { x, y } = snapPlacement(offer.type, rotation, vx, vy, session.map, objectsRef.current);

      ghostPos.current = { x, y };
      session.updateGhost(x, y, rotation);
    },
    [rotation],
  );

  // En PC se puede confirmar con Enter y girar con R, sin ir hasta el boton.
  useEffect(() => {
    if (state.phase !== 'placement' || !state.myOffer || state.myObjectPlaced) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        confirmPlacementRef.current();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        rotateRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase, state.myOffer, state.myObjectPlaced]);

  function rotate(): void {
    const session = sessionRef.current;
    const offer = session?.myOffer;
    if (!session || !offer) return;
    const next: 0 | 1 = rotation === 1 ? 0 : 1;
    setRotation(next);
    // Se gira sobre el centro actual y se vuelve a apoyar en la superficie.
    const type = objectType(offer.type)!;
    const cx = ghostPos.current.x + (rotation === 1 ? type.h : type.w) / 2;
    const cy = ghostPos.current.y + (rotation === 1 ? type.w : type.h) / 2;
    const pos = snapPlacement(offer.type, next, cx, cy, session.map, objectsRef.current);
    ghostPos.current = pos;
    session.updateGhost(pos.x, pos.y, next);
  }

  function confirmPlacement(): void {
    const ok = sessionRef.current?.confirmPlacement(
      ghostPos.current.x,
      ghostPos.current.y,
      rotation,
    );
    if (!ok) setError('Ahí no entra: buscá otro lugar');
    else setError(null);
  }

  // Los atajos de teclado siempre llaman a la version actual.
  const confirmPlacementRef = useRef<() => void>(() => undefined);
  const rotateRef = useRef<() => void>(() => undefined);
  confirmPlacementRef.current = confirmPlacement;
  rotateRef.current = rotate;

  async function backToLobby(): Promise<void> {
    try {
      await endMatch(room.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Juega quien el host dice que juega: la misma lista que usa la sesion.
  const amRacer = (state.roster.length > 0 ? state.roster : rosterRef.current).includes(userId);
  const building = state.phase === 'chaosBox' || state.phase === 'placement';
  const countdownLabel = state.countdown > 0.35 ? String(Math.ceil(state.countdown - 0.3)) : '¡YA!';
  const racing = state.phase === 'race';

  return (
    <div className="match" ref={hostRef}>
      <div className="match-hud">
        <div className="match-top">
          <div className="match-left">
            <div className="match-round">
              RONDA {state.round} · A {state.targetPoints}
            </div>
            <div className="match-timer">{formatClock(state.timeLeft)}</div>
          </div>
          <ul className="match-players">
            {racers.map((p) => {
              const sim = state.roundResult?.outcomes.find((o) => o.id === p.userId);
              const playerOffline = p.userId !== userId && !connected.has(p.userId);
              return (
                <li key={p.userId} className={racing && sim ? sim.phase : ''}>
                  <span className="player-dot" style={{ background: colorHex(p.color) }} />
                  <span className="match-player-name">{p.name}</span>
                  {playerOffline && <span className="tag tag-off">SIN CONEXIÓN</span>}
                  <span className="match-score">{state.totals[p.userId] ?? 0}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {!state.ready && state.phase !== 'idle' && !building && (
          <p className="match-note">Sincronizando reloj…</p>
        )}

        {state.phase !== 'idle' && !connected.has(room.hostId) && (
          <p className="match-note match-host-warning">Host desconectado — reasignando…</p>
        )}

        {state.phase === 'countdown' && (
          <div className="match-countdown">
            <span key={countdownLabel}>{countdownLabel}</span>
          </div>
        )}

        {racing && amRacer && (
          <div className="match-actions">
            {confirmSurrender ? (
              <div className="surrender-confirm">
                <span>¿Seguro que querés rendirte?</span>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    sessionRef.current?.surrender();
                    setConfirmSurrender(false);
                  }}
                >
                  SÍ
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmSurrender(false)}>
                  NO
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={() => setConfirmSurrender(true)}>
                RENDIRSE
              </button>
            )}
          </div>
        )}

        {!amRacer && state.phase !== 'idle' && (
          <p className="match-note match-spectator">MIRANDO COMO ESPECTADOR</p>
        )}
      </div>

      {state.phase === 'chaosBox' && (
        <ChaosBoxPanel
          state={state}
          byId={byId}
          canPick={amRacer}
          onPick={(id) => sessionRef.current?.pickOffer(id)}
        />
      )}

      {state.phase === 'placement' && (
        <PlacementLayer
          state={state}
          amRacer={amRacer}
          rotation={rotation}
          anchored={anchored}
          onMove={moveGhost}
          onAnchor={setAnchored}
          onRotate={rotate}
          onConfirm={confirmPlacement}
        />
      )}

      {state.phase === 'roundResults' && state.roundResult && (
        <RoundResults state={state} byId={byId} />
      )}

      {state.phase === 'matchEnd' && (
        <MatchEnd state={state} byId={byId} isHost={isHost} onBack={() => void backToLobby()} />
      )}

      {error && <p className="error error-banner">{error}</p>}

      <div className="match-debug">
        {state.ping > 0 && `${state.ping} ms`}
        {state.rollbacks > 0 && ` · ${state.rollbacks} correcciones`}
      </div>
    </div>
  );
}

/**
 * Fase de colocacion (§16).
 *
 * La capa transparente de arriba del canvas convierte donde toca el dedo (o
 * donde esta el mouse) en coordenadas del mapa. El fantasma se dibuja dentro
 * del juego, verde si entra y rojo si no, y los demas ven el tuyo a media
 * transparencia mientras lo movés.
 */
function PlacementLayer({
  state,
  amRacer,
  rotation,
  anchored,
  onMove,
  onAnchor,
  onRotate,
  onConfirm,
}: {
  state: MatchSnapshotState;
  amRacer: boolean;
  rotation: 0 | 1;
  anchored: boolean;
  onMove: (x: number, y: number, lift?: number) => void;
  onAnchor: (value: boolean) => void;
  onRotate: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const offer = state.myOffer;
  const type = offer ? objectType(offer.type) : null;
  const done = state.myObjectPlaced;
  const active = amRacer && Boolean(offer) && !done;

  /**
   * Mouse y dedo se comportan distinto porque se usan distinto:
   *  - Mouse: el fantasma sigue al cursor hasta el primer click. Ese click lo
   *    deja plantado ahi; otro click lo reubica.
   *  - Dedo: se arrastra, y al levantarlo queda donde lo dejaste.
   * En los dos casos, el objeto recien es definitivo al CONFIRMAR.
   */
  // Con el dedo el objeto se dibuja un poco mas arriba: si no, lo tapa la mano.
  const lift = (e: React.PointerEvent): number => (e.pointerType === 'mouse' ? 0 : TOUCH_LIFT);

  const handleDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onMove(e.clientX, e.clientY, lift(e));
    onAnchor(e.pointerType === 'mouse');
  };

  const handleMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse') {
      if (!anchored) onMove(e.clientX, e.clientY);
    } else if (e.buttons > 0) {
      onMove(e.clientX, e.clientY, lift(e));
    }
  };

  const handleUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType !== 'mouse') onAnchor(true);
  };

  const hint = !anchored
    ? 'Tocá o hacé click donde lo querés'
    : 'CONFIRMAR para fijarlo · click para reubicar';

  return (
    <>
      {active && (
        <div
          className={`placement-surface ${anchored ? 'anchored' : ''}`}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
      )}

      <div className="placement-bar">
        <div className="placement-info">
          <span className="phase-timer">{Math.ceil(state.phaseLeft)}</span>
          <span className="placement-text">
            {!amRacer
              ? 'MIRANDO'
              : !offer
                ? 'Te quedaste sin objeto esta ronda'
                : done
                  ? 'LISTO — esperando a los demás'
                  : `COLOCÁ: ${type?.name ?? ''}`}
          </span>
          {active && <span className="placement-hint">{hint}</span>}
        </div>

        {active && (
          <div className="placement-buttons">
            {type?.rotatable && (
              <button className="btn btn-small" onClick={onRotate}>
                GIRAR {rotation === 1 ? '↕' : '↔'}
              </button>
            )}
            <button
              className={`btn btn-primary btn-small ${anchored ? 'pulse' : ''}`}
              onClick={onConfirm}
            >
              CONFIRMAR
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function RoundResults({
  state,
  byId,
}: {
  state: MatchSnapshotState;
  byId: Map<string, RoomPlayer>;
}): JSX.Element {
  const result = state.roundResult!;
  const arrived = result.outcomes
    .filter((o) => o.phase === 'finished')
    .sort((a, b) => a.endTick - b.endTick);
  const rest = result.outcomes.filter((o) => o.phase !== 'finished');
  const ordered = [...arrived, ...rest];
  // Los motivos se recalculan del resultado: es la misma funcion pura que uso
  // el host, asi que coinciden exactamente con los puntos que se ven.
  const { scores } = scoreRound(result.outcomes, {
    round: result.round,
    totalsBefore: totalsBeforeRound(result.totals, result.points),
  });
  const reasonsById = new Map(scores.map((r) => [r.id, r.reasons]));

  return (
    <div className="results-overlay">
      <div className="screen results-card">
        <h2 className="screen-title-text">RONDA {result.round}</h2>
        <p className="note results-target">Gana el primero en llegar a {state.targetPoints}</p>

        <ol className="results-list">
          {ordered.map((o, i) => {
            const p = byId.get(o.id);
            const points = result.points[o.id] ?? 0;
            return (
              <li key={o.id} className={o.phase}>
                <span className="results-pos">{o.phase === 'finished' ? `${i + 1}º` : '—'}</span>
                <span className="player-dot" style={{ background: colorHex(p?.color ?? -1) }} />
                <span className="results-who">
                  <span className="player-name">{p?.name ?? '¿?'}</span>
                  <span className="results-reasons">
                    {describeReasons(reasonsById.get(o.id) ?? [], o, byId)}
                  </span>
                </span>
                <span className="results-detail">
                  {o.phase === 'finished' ? `${(o.endTick / TICK_RATE).toFixed(2)}s` : 'ELIMINADO'}
                </span>
                <span className={`results-points ${points > 0 ? 'gained' : ''}`}>
                  {points > 0 ? `+${points}` : '—'}
                </span>
                <span className="results-total">{result.totals[o.id] ?? 0}</span>
              </li>
            );
          })}
        </ol>

        {result.voided === 'everyoneArrived' && (
          <p className="note note-void">Llegaron todos: el nivel fue muy fácil y nadie suma.</p>
        )}
        {result.voided === 'nobodyArrived' && (
          <p className="note note-void">No llegó nadie: el nivel fue muy difícil y nadie suma.</p>
        )}

        <p className="note note-pending">
          {result.last
            ? `¡Alguien llegó a ${state.targetPoints}! Resultado final en ${Math.ceil(state.nextIn)}s…`
            : `Ronda ${result.round + 1} en ${Math.ceil(state.nextIn)}s…`}
        </p>
      </div>
    </div>
  );
}

/** "+3 1º · +2 trampa (ANA)": de donde salio cada punto. */
function describeReasons(
  reasons: ScoreReason[],
  outcome: { phase: string; killedBy: string | null },
  byId: Map<string, RoomPlayer>,
): string {
  const parts = reasons.map((r) => {
    switch (r.kind) {
      case 'goal':
        return `+${r.points} meta`;
      case 'first':
        return `+${r.points} primero`;
      case 'solo':
        return `+${r.points} solitario`;
      case 'comeback':
        return `+${r.points} remontada`;
      case 'late':
        return `+${r.points} ronda tardía`;
      case 'trap':
        return `+${r.points} trampa a ${byId.get(r.victim)?.name ?? '¿?'}`;
    }
  });
  if (outcome.phase === 'dead' && outcome.killedBy) {
    parts.push(`cayó en la trampa de ${byId.get(outcome.killedBy)?.name ?? '¿?'}`);
  }
  return parts.join(' · ');
}

function MatchEnd({
  state,
  byId,
  isHost,
  onBack,
}: {
  state: MatchSnapshotState;
  byId: Map<string, RoomPlayer>;
  isHost: boolean;
  onBack: () => void;
}): JSX.Element {
  const table = standings(state.totals);
  const champs = winners(state.totals);
  const championNames = champs.map((id) => byId.get(id)?.name ?? '¿?').join(' y ');

  return (
    <div className="results-overlay">
      <div className="screen results-card">
        <h2 className="match-end-title">{champs.length > 1 ? '¡EMPATE!' : '¡GANADOR!'}</h2>
        <p className="match-champion">{championNames || '—'}</p>

        <ol className="results-list">
          {table.map((row) => {
            const p = byId.get(row.id);
            const s = state.stats[row.id];
            return (
              <li key={row.id} className={champs.includes(row.id) ? 'finished' : ''}>
                <span className="results-pos">{row.place}º</span>
                <span className="player-dot" style={{ background: colorHex(p?.color ?? -1) }} />
                <span className="player-name">{p?.name ?? '¿?'}</span>
                <span className="results-detail">
                  {s ? `${s.roundsWon} rondas · ${s.finishes} metas` : ''}
                </span>
                <span className="results-total">{row.points}</span>
              </li>
            );
          })}
        </ol>

        {isHost ? (
          <button className="btn btn-primary" onClick={onBack}>
            VOLVER AL LOBBY
          </button>
        ) : (
          <p className="note">Esperando al host…</p>
        )}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
