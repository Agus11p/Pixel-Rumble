import type { VoidReason } from '../core/scoring';
import type { PlacedObject, PlayerState } from '../core/types';

/**
 * Todos los mensajes de red viven en este archivo, y solo en este archivo.
 *
 * La division es la de §35: eventos importantes (raros, con epoch y orden) por
 * un lado, y el flujo de movimiento por otro. El movimiento NO viaja como
 * posiciones cada frame: viaja como CAMBIOS DE INPUT, que son unos pocos
 * mensajes por segundo, y cada cliente simula el resto.
 */
export const PROTOCOL_VERSION = 1;

export type MatchPhase =
  | 'idle'
  | 'chaosBox'
  | 'placement'
  | 'countdown'
  | 'race'
  | 'roundResults'
  | 'matchEnd';

/** Un cambio de input: se emite solo cuando alguna tecla cambia de estado. */
export interface InputMsg {
  t: 'input';
  /** Jugador que lo emite. */
  u: string;
  /** Tick a partir del cual este input tiene efecto. */
  k: number;
  l: boolean;
  r: boolean;
  j: boolean;
}

/** Sincronizacion de reloj: el cliente pregunta, el host contesta. */
export interface PingMsg {
  t: 'ping';
  u: string;
  /** Marca de tiempo local del que pregunta, tal cual, para calcular el RTT. */
  c: number;
}

export interface PongMsg {
  t: 'pong';
  /** A quien va dirigido (los demas lo ignoran). */
  to: string;
  /** La marca original, devuelta sin tocar. */
  c: number;
  /** Tiempo del host al responder. */
  h: number;
}

/** Cambio de fase decidido por la autoridad. */
export interface PhaseMsg {
  t: 'phase';
  /** Epoch de autoridad: un mensaje de un host viejo se descarta. */
  e: number;
  phase: MatchPhase;
  /** Ids de los jugadores de la ronda, en orden fijo (define los spawns). */
  players: string[];
  /** Momento (reloj del host) en el que el tick 0 de la carrera empieza. */
  startAt: number;
  /** Duracion maxima de la carrera en ticks. */
  raceTicks: number;
  /** Ronda actual, empezando en 1. */
  round: number;
  /** Puntos necesarios para ganar la partida. */
  target: number;
  /** Puntos acumulados hasta ahora, para que nadie quede desfasado. */
  totals: Record<string, number>;
  /**
   * Semilla del Chaos Box. Con el mismo numero todos generan exactamente la
   * misma oferta, asi que la lista de objetos no viaja por la red.
   */
  seed: number;
  /** Objetos ya colocados en el mapa, acumulados desde el inicio (§17). */
  objects: PlacedObject[];
  /** Momento (reloj del host) en que vence la fase actual. */
  deadline: number;
  /**
   * Quien se quedo con cada objeto de la oferta. Viaja en cada fase para que
   * un cliente que se reconecta no pierda el objeto que ya habia elegido.
   */
  taken: Record<number, string>;
}

/** Un jugador reclama un objeto de la oferta. Resuelve el host (§15). */
export interface PickMsg {
  t: 'pick';
  u: string;
  offer: number;
}

/** El host confirma quien se quedo con cada objeto. */
export interface TakenMsg {
  t: 'taken';
  e: number;
  offer: number;
  u: string;
}

/** Previsualizacion en vivo de donde piensa poner su objeto (§16). */
export interface GhostMsg {
  t: 'ghost';
  u: string;
  type: string;
  x: number;
  y: number;
  rot: 0 | 1;
  ok: boolean;
}

/** Objeto confirmado: a partir de aca es parte del mapa. */
export interface PlacedMsg {
  t: 'placed';
  obj: PlacedObject;
}

/** Estadisticas basicas de la partida (§28). */
export interface MatchStats {
  roundsWon: number;
  finishes: number;
  trapKills: number;
}

/** Resultado canonico de una ronda, calculado por la autoridad. */
export interface RoundResultsMsg {
  t: 'round';
  e: number;
  round: number;
  outcomes: { id: string; phase: PlayerState['phase']; endTick: number; killedBy: string | null }[];
  points: Record<string, number>;
  totals: Record<string, number>;
  /** Si la regla de oro anulo la ronda, por que. */
  voided: VoidReason | null;
  /** Momento (reloj del host) en que arranca la ronda siguiente. */
  nextAt: number;
  /** True si con esta ronda se termino la partida. */
  last: boolean;
}

export interface MatchEndMsg {
  t: 'end';
  e: number;
  totals: Record<string, number>;
  stats: Record<string, MatchStats>;
}

/** Foto completa del estado. Sirve para entrar tarde y para migrar el host. */
export interface KeyframeMsg {
  t: 'key';
  e: number;
  tick: number;
  players: PlayerState[];
}

/** Un jugador abandona la ronda por decision propia (§23). */
export interface SurrenderMsg {
  t: 'surrender';
  u: string;
  k: number;
}

/** Alguien acaba de entrar al canal y pide una foto del estado. */
export interface HelloMsg {
  t: 'hello';
  u: string;
  v: number;
}

export type NetMessage =
  | InputMsg
  | PingMsg
  | PongMsg
  | PhaseMsg
  | KeyframeMsg
  | RoundResultsMsg
  | MatchEndMsg
  | PickMsg
  | TakenMsg
  | GhostMsg
  | PlacedMsg
  | SurrenderMsg
  | HelloMsg;
