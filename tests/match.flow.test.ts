import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIRTUAL_H, VIRTUAL_W } from '../src/core/constants';
import { MAP_ASCENSO } from '../src/core/map';
import { objectSize, objectType } from '../src/core/objects/catalog';
import { checkPlacement } from '../src/core/objects/placement';
import type { MatchTransport } from '../src/net/MatchChannel';
import { MatchSession } from '../src/net/MatchSession';
import type { MatchSnapshotState } from '../src/net/MatchSession';
import type { NetMessage } from '../src/net/protocol';

/**
 * Partidas completas de punta a punta, sin Supabase.
 *
 * Varias sesiones reales (un host y clientes) conectadas por una red en memoria
 * con latencia, y bots que eligen y colocan objetos como lo haria una persona.
 * Reproducen, de forma determinista, problemas que a mano solo aparecen despues
 * de varios minutos de juego: mensajes perdidos, reconexiones y pestanas que el
 * navegador deja de dibujar.
 */

const NEUTRAL = { left: false, right: false, jump: false };

class MemoryNetwork {
  private readonly peers = new Map<string, (m: NetMessage) => void>();
  /** Permite simular mensajes perdidos: devuelve true para descartarlo. */
  drop: (msg: NetMessage, to: string) => boolean = () => false;

  constructor(private readonly latencyMs: number) {}

  transport(id: string): MatchTransport {
    let mine: ((m: NetMessage) => void) | null = null;
    return {
      subscribe: async (onMessage) => {
        mine = onMessage;
        this.peers.set(id, onMessage);
      },
      send: (msg) => {
        // Como Supabase con self:false: le llega a todos menos al que lo manda.
        const copy = JSON.parse(JSON.stringify(msg)) as NetMessage;
        for (const [peer, deliver] of this.peers) {
          if (peer === id) continue;
          if (this.drop(copy, peer)) continue;
          setTimeout(() => this.peers.get(peer) === deliver && deliver(copy), this.latencyMs);
        }
      },
      unsubscribe: async () => {
        if (this.peers.get(id) === mine) this.peers.delete(id);
      },
    };
  }
}

interface Player {
  id: string;
  session: MatchSession;
  state: MatchSnapshotState | null;
  /** Fases por las que paso, en orden, con su numero de ronda. */
  timeline: string[];
}

function makeSession(
  player: Player,
  ids: string[],
  rounds: number,
  net: MemoryNetwork,
  isHost: boolean,
): MatchSession {
  return new MatchSession({
    roomId: 'sala',
    userId: player.id,
    isHost,
    // Los bots no corren, asi que nadie llega y nadie suma: la partida la
    // corta el tope de rondas, que aca se achica al numero pedido.
    targetPoints: 2000,
    maxRounds: rounds,
    roundSeconds: 30,
    getRoster: () => ids,
    transport: net.transport(player.id),
    onState: (s) => {
      player.state = s;
      const mark = `${s.round}:${s.phase}`;
      if (player.timeline[player.timeline.length - 1] !== mark) player.timeline.push(mark);
    },
  });
}

function makePlayers(
  ids: string[],
  rounds: number,
  latency: number,
  net = new MemoryNetwork(latency),
): Player[] {
  return ids.map((id, index) => {
    const player: Player = { id, session: null!, state: null, timeline: [] };
    player.session = makeSession(player, ids, rounds, net, index === 0);
    return player;
  });
}

/** Busca el primer lugar libre del mapa donde entra el objeto. */
function findSpot(p: Player): { x: number; y: number } | null {
  const offer = p.session.myOffer;
  const state = p.state;
  if (!offer || !state) return null;
  const type = objectType(offer.type)!;
  const size = objectSize(type, 0);
  for (let y = 40; y + size.h <= VIRTUAL_H; y += 8) {
    for (let x = 0; x + size.w <= VIRTUAL_W; x += 8) {
      const candidate = { id: 'probe', type: offer.type, ownerId: p.id, x, y, rotation: 0 as const };
      if (checkPlacement(candidate, MAP_ASCENSO, state.objects).valid) return { x, y };
    }
  }
  return null;
}

/** Lo que haria una persona en cada fase. */
function actAsBot(p: Player): void {
  const s = p.state;
  if (!s) return;
  if (s.phase === 'chaosBox' && !p.session.myOffer) {
    const free = s.offers.find((o) => !o.takenBy);
    if (free) p.session.pickOffer(free.id);
  }
  if (s.phase === 'placement' && p.session.myOffer && !s.myObjectPlaced) {
    const spot = findSpot(p);
    if (spot) p.session.confirmPlacement(spot.x, spot.y, 0);
  }
}

interface PlayOptions {
  frameMs?: number;
  /** Si devuelve false, ese jugador no dibuja ese frame (pestana tapada). */
  rendering?: (p: Player, t: number) => boolean;
  /** Se llama en cada frame, para meter eventos a mitad de partida. */
  onFrame?: (t: number) => Promise<void> | void;
}

async function play(players: Player[], seconds: number, opts: PlayOptions = {}): Promise<void> {
  const frameMs = opts.frameMs ?? 50;
  for (const p of players) await p.session.start();
  players[0]!.session.beginMatch();

  for (let t = 0; t < seconds * 1000; t += frameMs) {
    await opts.onFrame?.(t);
    for (const p of players) {
      if (opts.rendering && !opts.rendering(p, t)) continue;
      p.session.update(NEUTRAL);
      actAsBot(p);
    }
    await vi.advanceTimersByTimeAsync(frameMs);
    if (players.every((p) => p.state?.phase === 'matchEnd')) break;
  }
  for (const p of players) await p.session.destroy();
}

function useFakeClock(): void {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

describe('partida completa entre varios clientes', () => {
  useFakeClock();

  it('el cliente sigue al host por todas las rondas hasta el final', async () => {
    const players = makePlayers(['host', 'cliente'], 3, 60);
    await play(players, 400);

    const [host, client] = players;
    expect(host!.state?.phase).toBe('matchEnd');
    expect(client!.state?.phase).toBe('matchEnd');

    for (const round of [1, 2, 3]) {
      for (const phase of ['chaosBox', 'placement', 'countdown', 'race', 'roundResults']) {
        expect(client!.timeline, `falta ${round}:${phase}`).toContain(`${round}:${phase}`);
      }
    }
  });

  it('en cada ronda el cliente consigue objeto y lo coloca', async () => {
    const players = makePlayers(['host', 'cliente'], 3, 60);
    await play(players, 400);

    const objects = players[0]!.state!.objects;
    expect(objects).toHaveLength(6);
    expect(objects.filter((o) => o.ownerId === 'cliente')).toHaveLength(3);
    expect(objects.filter((o) => o.ownerId === 'host')).toHaveLength(3);
  });

  it('host y clientes terminan con el mismo mapa y los mismos puntos', async () => {
    const players = makePlayers(['host', 'ana', 'beto'], 3, 90);
    await play(players, 400);

    const reference = players[0]!.state!;
    for (const p of players.slice(1)) {
      expect(p.state!.phase).toBe('matchEnd');
      expect(p.state!.totals).toEqual(reference.totals);
      expect(p.state!.objects.map((o) => o.id).sort()).toEqual(
        reference.objects.map((o) => o.id).sort(),
      );
    }
  });

  it('la colocacion termina antes si ya colocaron todos', async () => {
    const players = makePlayers(['host', 'cliente'], 1, 60);
    let placementAt = -1;
    let countdownAt = -1;
    await play(players, 200, {
      onFrame: (t) => {
        const phase = players[1]!.state?.phase;
        if (phase === 'placement' && placementAt < 0) placementAt = t;
        if (phase === 'countdown' && countdownAt < 0) countdownAt = t;
      },
    });
    // Los bots colocan al instante: no hace falta esperar los 20 segundos.
    expect(placementAt).toBeGreaterThanOrEqual(0);
    expect(countdownAt - placementAt).toBeLessThan(5000);
  });
});

describe('partidas con problemas de red y de navegador', () => {
  useFakeClock();

  it('si el host deja de dibujar (ventana tapada), la partida sigue igual', async () => {
    const players = makePlayers(['host', 'cliente'], 2, 60);
    // El host solo dibuja los primeros 2 segundos; despues su pestana queda en
    // segundo plano y el navegador deja de llamar a requestAnimationFrame.
    // Los bots del host tambien dejan de actuar: no eligen ni colocan nada.
    await play(players, 400, { rendering: (p, t) => p.id !== 'host' || t < 2000 });

    const client = players[1]!;
    expect(client.state?.phase).toBe('matchEnd');
    expect(client.timeline).toContain('2:placement');
    expect(client.timeline).toContain('2:race');
  });

  it('si se pierden cambios de fase, el cliente se pone al dia solo', async () => {
    const net = new MemoryNetwork(60);
    const players = makePlayers(['host', 'cliente'], 2, 60, net);
    // Se pierde el PRIMER aviso de cada fase dirigido al cliente.
    const seen = new Set<string>();
    net.drop = (msg, to) => {
      if (to !== 'cliente' || msg.t !== 'phase') return false;
      const key = `${msg.round}:${msg.phase}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    await play(players, 500);

    const client = players[1]!;
    expect(client.state?.phase).toBe('matchEnd');
    for (const phase of ['chaosBox', 'placement', 'countdown', 'race']) {
      expect(client.timeline, `falta 2:${phase}`).toContain(`2:${phase}`);
    }
  });

  it('un cliente que se reconecta en plena eleccion no pierde su objeto', async () => {
    const ids = ['host', 'cliente'];
    const net = new MemoryNetwork(60);
    const players = makePlayers(ids, 2, 60, net);
    const client = players[1]!;
    let offerBefore = -1;
    let offerAfter = -2;

    await play(players, 400, {
      onFrame: async () => {
        // En la ronda 2, apenas eligio, se le cae la conexion y vuelve a entrar
        // con una sesion nueva (como un F5 o un remontaje de React).
        if (
          offerBefore < 0 &&
          client.state?.round === 2 &&
          client.state.phase === 'chaosBox' &&
          client.session.myOffer
        ) {
          offerBefore = client.session.myOffer.id;
          await client.session.destroy();
          client.session = makeSession(client, ids, 2, net, false);
          await client.session.start();
          // En cuanto el host lo pone al dia, tiene que recuperar el mismo objeto.
          await vi.advanceTimersByTimeAsync(2500);
          offerAfter = client.session.myOffer?.id ?? -3;
        }
      },
    });

    expect(offerBefore).toBeGreaterThanOrEqual(0);
    expect(offerAfter).toBe(offerBefore);
    expect(client.state?.phase).toBe('matchEnd');
    const clientObjects = players[0]!.state!.objects.filter((o) => o.ownerId === 'cliente');
    expect(clientObjects).toHaveLength(2);
  });
});
