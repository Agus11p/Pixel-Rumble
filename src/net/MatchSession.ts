import { MS_PER_TICK, TICK_RATE } from '../core/constants';
import { generateOffers, offerCount } from '../core/chaosbox';
import type { Offer } from '../core/chaosbox';
import { MAP_ASCENSO } from '../core/map';
import { checkPlacement } from '../core/objects/placement';
import { everyoneDone } from '../core/simulation';
import { SCORING, addToTotals, matchIsOver, scoreRound } from '../core/scoring';
import type { RoundOutcome, RoundScore } from '../core/scoring';
import type { InputState, PlacedObject, PlayerState } from '../core/types';
import { ClockSync } from './clock';
import { MatchChannel } from './MatchChannel';
import type { MatchTransport } from './MatchChannel';
import { RollbackSim } from './RollbackSim';
import type { MatchPhase, MatchStats, NetMessage, PhaseMsg, RoundResultsMsg } from './protocol';
import { PROTOCOL_VERSION } from './protocol';

/** Cuanto dura la eleccion de objeto (§15). */
export const CHAOSBOX_MS = 10000;
/** Cuanto dura la colocacion (§16). Termina antes si todos ya colocaron. */
export const PLACEMENT_MS = 20000;
/** Pausa corta cuando todos terminaron antes de tiempo, para que no sea brusco. */
const EARLY_FINISH_MS = 1200;
/**
 * Cada cuanto el host repite la fase actual. Supabase Realtime no garantiza
 * entrega: si un cliente se pierde un cambio de fase, con esto se pone al dia
 * solo en vez de quedar congelado.
 */
const PHASE_HEARTBEAT_MS = 2000;
/** Ritmo del reloj interno de la sesion, independiente del dibujado. */
const PUMP_MS = 100;

/** Orden natural de las fases dentro de una ronda. */
const PHASE_ORDER: MatchPhase[] = [
  'idle',
  'chaosBox',
  'placement',
  'countdown',
  'race',
  'roundResults',
  'matchEnd',
];
/** Cuenta regresiva antes del tick 0 de cada ronda. */
export const COUNTDOWN_MS = 3300;
/** Cuanto se muestran los resultados antes de la ronda siguiente. */
export const RESULTS_MS = 7000;
/** Cada cuanto el host manda una foto completa del estado. */
const KEYFRAME_MS = 2000;

export interface MatchSnapshotState {
  phase: MatchPhase;
  /** Quienes juegan esta ronda segun el host. Es la lista que manda. */
  roster: string[];
  round: number;
  /** Puntos necesarios para ganar. */
  targetPoints: number;
  /** Segundos que faltan para el GO (solo en countdown). */
  countdown: number;
  /** Segundos que quedan de carrera. */
  timeLeft: number;
  /** Segundos hasta la ronda siguiente (solo en resultados). */
  nextIn: number;
  roundResult: RoundResultsMsg | null;
  /** Segundos que quedan de la fase actual (eleccion o colocacion). */
  phaseLeft: number;
  offers: Offer[];
  /** Objeto que le toco al jugador local, si eligio alguno. */
  myOffer: Offer | null;
  /** True cuando ya confirmo donde ponerlo. */
  myObjectPlaced: boolean;
  objects: PlacedObject[];
  ghosts: GhostPreview[];
  totals: Record<string, number>;
  stats: Record<string, MatchStats>;
  ready: boolean;
  ping: number;
  rollbacks: number;
}

export interface GhostPreview {
  userId: string;
  type: string;
  x: number;
  y: number;
  rotation: 0 | 1;
  valid: boolean;
}

export interface MatchSessionOptions {
  roomId: string;
  userId: string;
  isHost: boolean;
  /** Puntos para ganar la partida. */
  targetPoints: number;
  roundSeconds: number;
  /** Tope de rondas (por defecto el de SCORING). Los tests lo achican. */
  maxRounds?: number;
  /** Jugadores activos ahora mismo, ya ordenados. El host lo consulta en cada ronda. */
  getRoster: () => string[];
  /** Aviso al host de que termino una ronda (para promover espectadores). */
  onRoundEnd?: () => void;
  onState: (state: MatchSnapshotState) => void;
  /** Red a usar. Por defecto Supabase Realtime; los tests inyectan una en memoria. */
  transport?: MatchTransport;
}

/**
 * Una partida completa: varias rondas, puntos y final.
 *
 * Reparto de responsabilidades:
 *  - El HOST decide las fases y publica el resultado canonico de cada ronda.
 *  - TODOS simulan la carrera entera con RollbackSim y calculan los puntos con
 *    el mismo modulo puro. Como la simulacion y la puntuacion son
 *    deterministas, el resultado local aparece al instante y el mensaje del
 *    host solo lo confirma; no hay pantalla de "esperando al servidor".
 *
 * El reloj comun (ClockSync) hace que "la ronda empieza en el instante X"
 * signifique lo mismo en los cuatro dispositivos.
 */
export class MatchSession {
  readonly clock: ClockSync;
  sim: RollbackSim;

  private readonly channel: MatchTransport;
  private readonly opts: MatchSessionOptions;

  private phase: MatchPhase = 'idle';
  private targetPoints: number;
  private epoch = 1;
  private round = 0;
  private startAt = 0;
  private nextAt = 0;
  private raceTicks: number;
  private roster: string[];

  private offers: Offer[] = [];
  private seed = 0;
  private deadline = 0;
  private placedObjects: PlacedObject[] = [];
  private myObjectPlaced = false;
  private readonly ghosts = new Map<string, GhostPreview>();
  private lastGhostSent = 0;

  private totals: Record<string, number> = {};
  private stats: Record<string, MatchStats> = {};
  private roundResult: RoundResultsMsg | null = null;
  private scoredRound = 0;

  private totalsVersion = 0;
  private lastSignature = '';

  private lastPhaseBroadcast = 0;
  private earlyFinishScheduled = false;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;

  private lastSentInput: InputState = { left: false, right: false, jump: false };
  private inputEverSent = false;
  private lastKeyframe = 0;
  private rtt = 0;

  constructor(options: MatchSessionOptions) {
    this.opts = options;
    this.targetPoints = options.targetPoints;
    this.raceTicks = options.roundSeconds * TICK_RATE;
    this.roster = options.getRoster();
    this.clock = new ClockSync(options.isHost);
    this.sim = new RollbackSim(MAP_ASCENSO, this.roster);
    this.channel = options.transport ?? new MatchChannel(options.roomId);
  }

  /** Fraccion de tick ya transcurrida, para que el render interpole. */
  get renderAlpha(): number {
    if (this.phase !== 'race') return 0;
    const exact = (this.clock.now() - this.startAt) / MS_PER_TICK;
    return Math.min(Math.max(exact - this.sim.tick, 0), 1);
  }

  get isSpectator(): boolean {
    return !this.roster.includes(this.opts.userId);
  }

  get currentRoster(): string[] {
    return this.roster;
  }

  async start(): Promise<void> {
    await this.channel.subscribe((m) => this.onMessage(m));
    this.channel.send({ t: 'hello', u: this.opts.userId, v: PROTOCOL_VERSION });
    // Reloj propio: la partida avanza aunque esta pestana no se este dibujando.
    // Antes todo dependia de requestAnimationFrame, que el navegador pausa en
    // ventanas tapadas o en segundo plano, y si eso le pasaba al host la
    // partida entera se quedaba congelada para los demas.
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
    this.emit();
  }

  /** Solo el host. Arranca la primera ronda. */
  beginMatch(): void {
    if (!this.opts.isHost) return;
    this.totals = {};
    this.stats = {};
    this.round = 0;
    // Partida nueva, mapa limpio: los objetos de la anterior no sobreviven (§17).
    this.placedObjects = [];
    this.beginRound();
  }

  /** Arranca la ronda por el Chaos Box: primero se elige, despues se coloca. */
  private beginRound(): void {
    this.round++;
    // La lista se relee en cada ronda: asi entran los que estaban esperando y
    // salen los que abandonaron, sin tocar nada mas (§10).
    this.roster = this.opts.getRoster();
    for (const id of this.roster) this.totals[id] ??= 0;

    this.seed = (this.round * 7919 + Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.offers = generateOffers(this.seed, offerCount(this.roster.length));
    this.ghosts.clear();
    this.myObjectPlaced = false;
    this.roundResult = null;
    this.earlyFinishScheduled = false;
    this.phase = 'chaosBox';
    this.deadline = this.clock.now() + CHAOSBOX_MS;
    this.rebuildPreview();
    this.broadcastPhase();
    this.emit();
  }

  private beginPlacement(): void {
    this.earlyFinishScheduled = false;
    this.phase = 'placement';
    this.deadline = this.clock.now() + PLACEMENT_MS;
    this.broadcastPhase();
    this.emit();
  }

  private beginCountdown(): void {
    this.ghosts.clear();
    this.phase = 'countdown';
    this.startAt = this.clock.now() + COUNTDOWN_MS;
    this.inputEverSent = false;
    this.sim = new RollbackSim(MAP_ASCENSO, this.roster, this.placedObjects);
    this.broadcastPhase();
    this.emit();
  }

  /**
   * Mundo de vitrina para las fases de construccion: nadie se mueve, pero se
   * ve el mapa con todo lo que hay colocado hasta ahora.
   */
  private rebuildPreview(): void {
    this.sim = new RollbackSim(MAP_ASCENSO, this.roster, this.placedObjects);
  }

  private broadcastPhase(): void {
    this.channel.send({
      t: 'phase',
      e: this.epoch,
      phase: this.phase,
      players: this.roster,
      startAt: this.startAt,
      raceTicks: this.raceTicks,
      round: this.round,
      target: this.targetPoints,
      totals: this.totals,
      seed: this.seed,
      objects: this.placedObjects,
      deadline: this.deadline,
      taken: Object.fromEntries(
        this.offers.filter((o) => o.takenBy).map((o) => [o.id, o.takenBy as string]),
      ),
    });
    this.lastPhaseBroadcast = this.clock.localNow();
  }

  /**
   * Se llama una vez por frame. Muestrea el input local, lo emite si cambio, y
   * lleva la simulacion al tick que corresponde segun el reloj comun.
   */
  update(localInput: InputState): void {
    this.pump();
    if (this.phase === 'race') {
      this.sendInputIfChanged(localInput);
      // Recien aplicado el input propio, se vuelve a llevar al tick actual.
      this.pump();
    }
  }

  /**
   * Hace avanzar la partida segun el reloj comun. Lo llaman el dibujado (para
   * que se vea fluido) y un temporizador propio (para que nunca se frene).
   * Llamarlo de mas no tiene efecto: todo se calcula contra el reloj.
   */
  private pump(): void {
    if (this.clock.shouldPing()) {
      this.channel.send({ t: 'ping', u: this.opts.userId, c: this.clock.localNow() });
    }

    if (this.opts.isHost) this.heartbeat();

    if (this.phase === 'idle' || this.phase === 'matchEnd') {
      this.emit();
      return;
    }

    if (this.phase === 'roundResults') {
      // El host es quien decide cuando arranca la ronda siguiente.
      if (this.opts.isHost && this.clock.now() >= this.nextAt) {
        if (this.roundResult?.last) this.endMatch();
        else this.beginRound();
      }
      this.emit();
      return;
    }

    // Elegir y colocar: nadie se mueve, solo corre el reloj de la fase.
    if (this.phase === 'chaosBox' || this.phase === 'placement') {
      if (this.opts.isHost) {
        this.maybeFinishEarly();
        if (this.clock.now() >= this.deadline) {
          if (this.phase === 'chaosBox') this.beginPlacement();
          else this.beginCountdown();
        }
      }
      this.emit();
      return;
    }

    const elapsed = this.clock.now() - this.startAt;

    if (this.phase === 'countdown') {
      // Todos congelados hasta el GO: no se simula ni un tick (§20).
      if (elapsed < 0) {
        this.emit();
        return;
      }
      this.phase = 'race';
    }

    this.sim.advanceTo(Math.min(Math.floor(elapsed / MS_PER_TICK), this.raceTicks));

    if (this.opts.isHost) this.maybeKeyframe();

    if (everyoneDone(this.sim.world) || this.sim.tick >= this.raceTicks) this.finishRound();

    this.emit();
  }

  /**
   * El host repite la fase cada tanto. Es lo que vuelve al sistema tolerante a
   * mensajes perdidos: un cliente que se salteo un cambio de fase se entera en
   * el proximo latido. En carrera no hace falta, ya viajan los keyframes.
   */
  private heartbeat(): void {
    if (this.phase === 'idle' || this.phase === 'race') return;
    if (this.clock.localNow() - this.lastPhaseBroadcast < PHASE_HEARTBEAT_MS) return;
    if (this.phase === 'matchEnd') {
      this.channel.send({ t: 'end', e: this.epoch, totals: this.totals, stats: this.stats });
      this.lastPhaseBroadcast = this.clock.localNow();
      return;
    }
    if (this.phase === 'roundResults' && this.roundResult) {
      this.channel.send(this.roundResult);
      this.lastPhaseBroadcast = this.clock.localNow();
      return;
    }
    this.broadcastPhase();
  }

  /** Si todos ya eligieron (o colocaron), no tiene sentido esperar al reloj. */
  private maybeFinishEarly(): void {
    if (this.earlyFinishScheduled) return;
    const players = this.roster;
    if (players.length === 0) return;

    const everyoneDone =
      this.phase === 'chaosBox'
        ? players.every((id) => this.offers.some((o) => o.takenBy === id))
        : this.offers
            .filter((o) => o.takenBy)
            .every((o) => this.placedObjects.some((obj) => obj.id === this.objectIdFor(o.takenBy!)));

    if (!everyoneDone) return;
    this.earlyFinishScheduled = true;
    const soon = this.clock.now() + EARLY_FINISH_MS;
    if (soon < this.deadline) {
      this.deadline = soon;
      this.broadcastPhase();
    }
  }

  private sendInputIfChanged(input: InputState): void {
    if (this.isSpectator) return;
    const changed =
      !this.inputEverSent ||
      input.left !== this.lastSentInput.left ||
      input.right !== this.lastSentInput.right ||
      input.jump !== this.lastSentInput.jump;
    if (!changed) return;

    this.lastSentInput = { ...input };
    this.inputEverSent = true;
    const tick = this.sim.tick;
    this.sim.applyInput(this.opts.userId, tick, this.lastSentInput);
    this.channel.send({
      t: 'input',
      u: this.opts.userId,
      k: tick,
      l: input.left,
      r: input.right,
      j: input.jump,
    });
  }

  private maybeKeyframe(): void {
    const now = this.clock.localNow();
    if (now - this.lastKeyframe < KEYFRAME_MS) return;
    this.lastKeyframe = now;
    const snap = this.sim.snapshot();
    this.channel.send({ t: 'key', e: this.epoch, tick: snap.tick, players: snap.players });
  }

  private outcomes(): RoundOutcome[] {
    return this.sim.world.players.map((p: PlayerState) => ({
      id: p.id,
      phase: p.phase,
      endTick: p.endTick,
      // Viene de la simulacion: la trampa que lo mato sabe de quien es (§26).
      killedBy: p.killedBy,
    }));
  }

  /**
   * Cierra la ronda. Lo corren todos: como la puntuacion es una funcion pura
   * sobre un estado identico, el resultado local ya es el correcto y el mensaje
   * del host solo lo confirma.
   */
  private finishRound(): void {
    if (this.scoredRound === this.round) return;
    this.scoredRound = this.round;

    const outcomes = this.outcomes();
    const { scores: roundScores, voided } = scoreRound(outcomes, {
      round: this.round,
      totalsBefore: this.totals,
    });
    this.totals = addToTotals(this.totals, roundScores);
    this.totalsVersion++;
    this.accumulateStats(outcomes, roundScores);

    const last = matchIsOver(
      this.totals,
      this.targetPoints,
      this.round,
      this.opts.maxRounds ?? SCORING.maxRounds,
    );
    this.nextAt = this.clock.now() + RESULTS_MS;
    this.phase = 'roundResults';
    this.roundResult = {
      t: 'round',
      e: this.epoch,
      round: this.round,
      outcomes: outcomes.map((o) => ({ ...o, killedBy: o.killedBy ?? null })),
      points: Object.fromEntries(roundScores.map((s) => [s.id, s.points])),
      totals: this.totals,
      voided,
      nextAt: this.nextAt,
      last,
    };

    if (this.opts.isHost) {
      this.channel.send(this.roundResult);
      this.opts.onRoundEnd?.();
    }
  }

  private accumulateStats(outcomes: RoundOutcome[], roundScores: RoundScore[]): void {
    for (const id of this.roster) {
      this.stats[id] ??= { roundsWon: 0, finishes: 0, trapKills: 0 };
    }
    for (const o of outcomes) {
      const s = this.stats[o.id];
      if (s && o.phase === 'finished') s.finishes++;
    }
    for (const score of roundScores) {
      const s = this.stats[score.id];
      if (!s) continue;
      s.trapKills += score.reasons.filter((r) => r.kind === 'trap').length;
    }
    // Gana la ronda quien mas puntos saco, siempre que haya sacado alguno.
    const best = Math.max(0, ...roundScores.map((s) => s.points));
    if (best > 0) {
      for (const score of roundScores) {
        if (score.points === best) this.stats[score.id]!.roundsWon++;
      }
    }
  }

  private endMatch(): void {
    this.phase = 'matchEnd';
    this.channel.send({ t: 'end', e: this.epoch, totals: this.totals, stats: this.stats });
    this.emit();
  }

  // ------------------------------------------------------------- Chaos Box --

  /**
   * Reclama un objeto de la oferta.
   *
   * La ultima palabra la tiene el host (§15): si dos personas tocan el mismo
   * objeto en el mismo instante, el host atiende al primero que le llega y el
   * otro simplemente ve que ya no esta. Sin mensajes de empate, sin esperas.
   */
  pickOffer(offerId: number): void {
    if (this.phase !== 'chaosBox' || this.isSpectator) return;
    if (this.myOffer) return;
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer || offer.takenBy) return;

    if (this.opts.isHost) this.resolvePick(offerId, this.opts.userId);
    else this.channel.send({ t: 'pick', u: this.opts.userId, offer: offerId });
  }

  private resolvePick(offerId: number, userId: string): void {
    const offer = this.offers.find((o) => o.id === offerId);
    if (!offer || offer.takenBy) return;
    if (this.offers.some((o) => o.takenBy === userId)) return; // uno por jugador
    offer.takenBy = userId;
    this.channel.send({ t: 'taken', e: this.epoch, offer: offerId, u: userId });
    this.emit();
  }

  get myOffer(): Offer | null {
    return this.offers.find((o) => o.takenBy === this.opts.userId) ?? null;
  }

  // ------------------------------------------------------------ Colocacion --

  /** Mueve la previsualizacion y avisa a los demas, sin saturar la red. */
  updateGhost(x: number, y: number, rotation: 0 | 1): void {
    const offer = this.myOffer;
    if (this.phase !== 'placement' || !offer || this.myObjectPlaced) return;

    const candidate: PlacedObject = {
      id: this.objectId(),
      type: offer.type,
      ownerId: this.opts.userId,
      x,
      y,
      rotation,
    };
    const valid = checkPlacement(candidate, MAP_ASCENSO, this.placedObjects).valid;
    this.ghosts.set(this.opts.userId, {
      userId: this.opts.userId,
      type: offer.type,
      x,
      y,
      rotation,
      valid,
    });

    // Los fantasmas ajenos son un lujo visual: alcanza con refrescarlos unas
    // pocas veces por segundo (§16).
    const now = this.clock.localNow();
    if (now - this.lastGhostSent > 120) {
      this.lastGhostSent = now;
      this.channel.send({
        t: 'ghost',
        u: this.opts.userId,
        type: offer.type,
        x,
        y,
        rot: rotation,
        ok: valid,
      });
    }
    this.emit();
  }

  /** Confirma la posicion. A partir de aca el objeto es parte del mapa (§17). */
  confirmPlacement(x: number, y: number, rotation: 0 | 1): boolean {
    const offer = this.myOffer;
    if (this.phase !== 'placement' || !offer || this.myObjectPlaced) return false;

    const obj: PlacedObject = {
      id: this.objectId(),
      type: offer.type,
      ownerId: this.opts.userId,
      x,
      y,
      rotation,
    };
    if (!checkPlacement(obj, MAP_ASCENSO, this.placedObjects).valid) return false;

    this.applyPlacement(obj);
    this.myObjectPlaced = true;
    this.ghosts.delete(this.opts.userId);
    this.channel.send({ t: 'placed', obj });
    this.emit();
    return true;
  }

  private applyPlacement(obj: PlacedObject): void {
    if (this.placedObjects.some((o) => o.id === obj.id)) return;
    this.placedObjects = [...this.placedObjects, obj];
    this.rebuildPreview();
  }

  private objectId(): string {
    return this.objectIdFor(this.opts.userId);
  }

  /** Un objeto por jugador por ronda, asi que el id sale de ahi. */
  private objectIdFor(userId: string): string {
    return `${userId}-r${this.round}`;
  }

  /** Rendirse (§23). La confirmacion la pide la UI antes de llegar aca. */
  surrender(): void {
    if (this.phase !== 'race' || this.isSpectator) return;
    const tick = this.sim.tick;
    this.channel.send({ t: 'surrender', u: this.opts.userId, k: tick });
    this.applySurrender(this.opts.userId, tick);
  }

  private applySurrender(id: string, tick: number): void {
    const p = this.sim.world.players.find((x) => x.id === id);
    if (!p || p.phase !== 'racing') return;
    p.phase = 'dead';
    p.endTick = tick;
    p.vx = 0;
    p.vy = 0;
  }

  private onMessage(m: NetMessage): void {
    switch (m.t) {
      case 'input':
        this.sim.applyInput(m.u, m.k, { left: m.l, right: m.r, jump: m.j });
        break;

      case 'ping':
        if (this.opts.isHost) {
          this.channel.send({ t: 'pong', to: m.u, c: m.c, h: this.clock.now() });
        }
        break;

      case 'pong':
        if (m.to === this.opts.userId) {
          this.rtt = this.clock.localNow() - m.c;
          this.clock.onPong(m.c, m.h);
        }
        break;

      case 'phase':
        if (m.e < this.epoch) return; // mensaje de un host viejo
        this.applyPhase(m);
        break;

      case 'key':
        if (m.e < this.epoch) return;
        this.sim.applyKeyframe(m.tick, m.players);
        break;

      case 'round':
        if (m.e < this.epoch) return;
        // Latido de una ronda que para este cliente ya quedo atras.
        if (m.round < this.round) break;
        // El host manda la version canonica: reemplaza, no suma.
        this.roundResult = m;
        this.totals = { ...m.totals };
        this.totalsVersion++;
        this.round = m.round;
        this.scoredRound = m.round;
        this.nextAt = m.nextAt;
        this.phase = 'roundResults';
        break;

      case 'end':
        if (m.e < this.epoch) return;
        this.totals = { ...m.totals };
        this.totalsVersion++;
        this.stats = m.stats;
        this.phase = 'matchEnd';
        break;

      case 'pick':
        // Solo el host reparte: es el unico que ve un orden unico de llegada.
        if (this.opts.isHost) this.resolvePick(m.offer, m.u);
        break;

      case 'taken': {
        if (m.e < this.epoch) return;
        const offer = this.offers.find((o) => o.id === m.offer);
        if (offer) offer.takenBy = m.u;
        break;
      }

      case 'ghost':
        if (this.phase !== 'placement') return;
        this.ghosts.set(m.u, {
          userId: m.u,
          type: m.type,
          x: m.x,
          y: m.y,
          rotation: m.rot,
          valid: m.ok,
        });
        break;

      case 'placed':
        this.applyPlacement(m.obj);
        this.ghosts.delete(m.obj.ownerId);
        break;

      case 'surrender':
        this.applySurrender(m.u, m.k);
        break;

      case 'hello':
        // Alguien acaba de llegar: el host le cuenta en que anda la partida.
        if (this.opts.isHost && this.phase !== 'idle') {
          this.broadcastPhase();
          const snap = this.sim.snapshot();
          this.channel.send({ t: 'key', e: this.epoch, tick: snap.tick, players: snap.players });
          if (this.roundResult) this.channel.send(this.roundResult);
          if (this.phase === 'matchEnd') {
            this.channel.send({
              t: 'end',
              e: this.epoch,
              totals: this.totals,
              stats: this.stats,
            });
          }
        }
        break;
    }
    this.emit();
  }

  /**
   * Avisa a la interfaz, pero solo cuando cambio algo que se ve.
   *
   * Esto se llama una vez por frame. Mandar un estado nuevo cada vez obligaba a
   * React a rehacer toda la pantalla de partida 60 veces por segundo, que en un
   * telefono es plata tirada: el juego se dibuja en el canvas, no en el DOM.
   * Con la firma de abajo la interfaz se actualiza unas dos veces por segundo y
   * al instante en cada cambio de fase.
   */
  /**
   * Aplica una fase del host.
   *
   * Tiene que poder recibirse repetida (el host la reenvia como latido) y en
   * cualquier momento (un cliente que se reconecta). Por eso compara con lo
   * que ya sabe y solo reinicia lo que de verdad cambio. Antes, un reenvio en
   * plena eleccion regeneraba la oferta desde cero y el cliente perdia el
   * objeto que ya habia elegido: el host le rechazaba cualquier otro y quedaba
   * trabado sin poder hacer nada.
   */
  private applyPhase(m: PhaseMsg): void {
    const sameRound = m.round === this.round;
    const alreadyRacing =
      sameRound && (this.phase === 'countdown' || this.phase === 'race') && m.phase === 'countdown';
    const alreadyAhead =
      sameRound &&
      PHASE_ORDER.indexOf(this.phase) > PHASE_ORDER.indexOf(m.phase) &&
      m.phase !== 'roundResults';

    this.epoch = m.e;
    this.raceTicks = m.raceTicks;
    this.round = m.round;
    this.targetPoints = m.target;
    this.deadline = m.deadline;
    this.roster = m.players;

    const totalsChanged = JSON.stringify(m.totals) !== JSON.stringify(this.totals);
    if (totalsChanged) {
      this.totals = { ...m.totals };
      this.totalsVersion++;
    }

    // Un latido atrasado nunca debe hacer retroceder a quien ya avanzo.
    if (alreadyAhead || alreadyRacing) return;

    const building = m.phase === 'chaosBox' || m.phase === 'placement';
    if (building) {
      if (!sameRound || this.seed !== m.seed || this.offers.length === 0) {
        this.seed = m.seed;
        this.offers = generateOffers(m.seed, offerCount(m.players.length));
        this.ghosts.clear();
        this.roundResult = null;
        this.scoredRound = 0;
        this.lastPlacementCount = -1;
      }
      // El host es la autoridad sobre quien tiene que: se copia tal cual.
      for (const offer of this.offers) offer.takenBy = m.taken[offer.id] ?? null;

      this.placedObjects = m.objects;
      this.myObjectPlaced = m.objects.some((o) => o.id === this.objectId());
      if (this.lastPlacementCount !== m.objects.length) {
        this.lastPlacementCount = m.objects.length;
        this.rebuildPreview();
      }
    }

    if (m.phase === 'countdown') {
      this.placedObjects = m.objects;
      this.ghosts.clear();
      this.sim = new RollbackSim(MAP_ASCENSO, m.players, m.objects);
      this.roundResult = null;
      this.scoredRound = 0;
      this.inputEverSent = false;
    }

    this.phase = m.phase;
    this.startAt = m.startAt;
  }

  private emit(): void {
    const now = this.clock.now();
    const elapsed = now - this.startAt;
    const countdown = this.phase === 'countdown' ? Math.max(0, -elapsed) / 1000 : 0;
    const timeLeft =
      this.phase === 'race'
        ? Math.max(0, (this.raceTicks - this.sim.tick) / TICK_RATE)
        : this.raceTicks / TICK_RATE;
    const nextIn = this.phase === 'roundResults' ? Math.max(0, (this.nextAt - now) / 1000) : 0;

    const signature = [
      this.phase,
      this.round,
      this.roster.join(','),
      Math.ceil(countdown),
      Math.ceil(timeLeft),
      Math.ceil(nextIn),
      this.roundResult?.round ?? -1,
      this.totalsVersion,
      Math.ceil(this.phaseRemaining(now)),
      this.offers.map((o) => o.takenBy ?? '').join(','),
      this.placedObjects.length,
      this.ghostSignature(),
      this.clock.ready,
      // Deja pasar dos refrescos por segundo para el ping y las correcciones.
      Math.floor(now / 500),
    ].join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.opts.onState({
      phase: this.phase,
      roster: this.roster,
      round: this.round,
      targetPoints: this.targetPoints,
      countdown,
      timeLeft,
      nextIn,
      roundResult: this.roundResult,
      phaseLeft:
        this.phase === 'chaosBox' || this.phase === 'placement'
          ? Math.max(0, (this.deadline - now) / 1000)
          : 0,
      offers: this.offers,
      myOffer: this.myOffer,
      myObjectPlaced: this.myObjectPlaced,
      objects: this.placedObjects,
      ghosts: [...this.ghosts.values()],
      totals: this.totals,
      stats: this.stats,
      ready: this.clock.ready,
      ping: Math.round(this.rtt),
      rollbacks: this.sim.rollbackCount,
    });
  }

  private lastPlacementCount = -1;

  private phaseRemaining(now: number): number {
    if (this.phase !== 'chaosBox' && this.phase !== 'placement') return 0;
    return Math.max(0, (this.deadline - now) / 1000);
  }

  /** Los fantasmas se mueven seguido: la firma incluye su posicion exacta. */
  private ghostSignature(): string {
    let out = '';
    for (const g of this.ghosts.values()) {
      out += `${g.userId}${g.x},${g.y},${g.rotation}${g.valid};`;
    }
    return out;
  }

  async destroy(): Promise<void> {
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    await this.channel.unsubscribe();
  }
}
