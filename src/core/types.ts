/** Rectangulo alineado a los ejes. x,y es la esquina superior izquierda. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Solido del mapa. `oneWay` = plataforma que solo frena al caer desde arriba. */
export interface Solid extends Rect {
  oneWay?: boolean;
  /** Multiplicador de agarre al pisarlo: <1 resbala, >1 frena de golpe. */
  friction?: number;
  /** Si es >0, al aterrizar impulsa hacia arriba con esa velocidad. */
  bounce?: number;
  /** Quien coloco el objeto del que salio este solido. */
  ownerId?: string;
}

/** Zona que mata al tocarla. Si vino de un objeto, recuerda de quien es. */
export interface Hazard extends Rect {
  ownerId?: string;
}

/** Un objeto ya colocado en el mapa. Sobrevive a las rondas (§17). */
export interface PlacedObject {
  id: string;
  type: string;
  ownerId: string;
  x: number;
  y: number;
  /** 0 = como se define en el catalogo, 1 = girado 90 grados. */
  rotation: 0 | 1;
}

/** Estado en el que puede estar un jugador dentro de una ronda. */
export type PlayerPhase = 'racing' | 'dead' | 'finished';

export type AnimState = 'idle' | 'run' | 'jump' | 'fall';

/**
 * Estado completo de un jugador.
 * Es data plana a proposito: se serializa, se clona y se compara sin sorpresas.
 */
export interface PlayerState {
  /** Identidad estable del jugador (user_id de Supabase). */
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  onGround: boolean;
  /** Ticks restantes de coyote time. */
  coyote: number;
  /** Ticks restantes de jump buffer. */
  jumpBuffer: number;
  /** Si el boton de salto venia presionado el tick anterior (para detectar flancos). */
  jumpHeld: boolean;
  /**
   * True mientras sube por un salto propio. Solo entonces soltar el boton
   * recorta el impulso: un empujon externo (resorte, plataforma) no se recorta.
   */
  jumping: boolean;
  phase: PlayerPhase;
  /** Tick en el que murio o llego. -1 si todavia corre. */
  endTick: number;
  /** Dueno del objeto que lo mato, si murio por una trampa ajena (§26). */
  killedBy: string | null;
  /** Agarre del suelo que esta pisando. 1 = normal, <1 resbala. */
  groundFriction: number;
  anim: AnimState;
}

/** Lo unico que la simulacion sabe del input. Identico en teclado y en tactil. */
export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
}

/**
 * Mapa estatico de una pantalla.
 *
 * Es DATA pura: nada de esto es logica. La fisica, el rollback y el placement
 * ya reciben un GameMap como parametro (nunca importan un mapa en particular),
 * asi que agregar un mapa nuevo es escribir esta forma con otros numeros y
 * registrarlo (ver `core/maps/registry.ts`) - no hay que tocar ningun sistema.
 */
export interface GameMap {
  /** Identificador unico y estable. Es lo que viaja por red y se guarda en la sala. */
  readonly id: string;
  /** Nombre para mostrar en pantalla. */
  readonly name: string;
  /** Ancho del mapa en pixeles virtuales. Hoy siempre VIRTUAL_W (camara fija). */
  readonly width: number;
  /** Alto del mapa en pixeles virtuales. Hoy siempre VIRTUAL_H (camara fija). */
  readonly height: number;
  /** Una posicion de salida por jugador, para que no aparezcan encimados. */
  readonly spawns: readonly { x: number; y: number }[];
  readonly solids: readonly Solid[];
  readonly hazards: readonly Hazard[];
  readonly goal: Rect;
}

/**
 * Estado mutable de una carrera.
 *
 * El orden del array de jugadores es parte del estado: la simulacion los
 * recorre siempre en el mismo orden, y eso es lo que hace que dos clientes
 * lleguen exactamente al mismo resultado.
 */
export interface World {
  tick: number;
  players: PlayerState[];
  readonly map: GameMap;
  /** Objetos colocados por los jugadores, acumulados a lo largo de la partida. */
  readonly objects: readonly PlacedObject[];
  /**
   * Geometria efectiva de la ronda: el mapa base MAS los objetos colocados.
   * Se arma una sola vez al crear el mundo, porque durante la carrera no
   * cambia, y asi la simulacion no recalcula nada por tick.
   */
  readonly solids: readonly Solid[];
  readonly hazards: readonly Hazard[];
}

/** Inputs de todos los jugadores para un tick, indexados por id. */
export type InputsByPlayer = Readonly<Record<string, InputState>>;

export const NEUTRAL_INPUT: Readonly<InputState> = Object.freeze({
  left: false,
  right: false,
  jump: false,
});
