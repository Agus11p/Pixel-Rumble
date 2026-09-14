/** Cuantas muestras se guardan para estimar el desfase de reloj. */
const SAMPLES = 7;
/** Cada cuanto se vuelve a medir (ms). */
const PING_INTERVAL = 3000;

/**
 * Reloj comun de la partida (§20).
 *
 * Cada cliente estima cuanto se lleva su reloj con el del host con el mismo
 * metodo que usa NTP: manda una marca, el host la devuelve con la suya, y de
 * la ida y vuelta se deduce el desfase. Se queda con la MEDIANA de varias
 * muestras, que descarta los picos de latencia en lugar de promediarlos.
 *
 * Con esto, "la carrera empieza en el instante X" significa lo mismo para
 * todos, y el countdown no depende de un setTimeout local.
 */
export class ClockSync {
  private offset = 0;
  private readonly samples: number[] = [];
  private lastPing = 0;

  constructor(private readonly isHost: boolean) {}

  /** Tiempo local monotono. */
  localNow(): number {
    return performance.now();
  }

  /** Tiempo estimado del host. Es el que se usa para cualquier acuerdo. */
  now(): number {
    return performance.now() + this.offset;
  }

  /** True si conviene mandar otro ping. */
  shouldPing(): boolean {
    if (this.isHost) return false;
    const t = performance.now();
    if (t - this.lastPing < (this.samples.length < SAMPLES ? 250 : PING_INTERVAL)) return false;
    this.lastPing = t;
    return true;
  }

  /** @param sentAt marca local que se envio  @param hostTime reloj del host al responder */
  onPong(sentAt: number, hostTime: number): void {
    const received = performance.now();
    const rtt = received - sentAt;
    // Al llegar la respuesta, el host va por hostTime + medio viaje de vuelta.
    const sample = hostTime + rtt / 2 - received;

    this.samples.push(sample);
    if (this.samples.length > SAMPLES) this.samples.shift();

    const sorted = [...this.samples].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)]!;
  }

  /** Cuantas muestras hay: por debajo de 3 el reloj todavia no es confiable. */
  get quality(): number {
    return this.isHost ? SAMPLES : this.samples.length;
  }

  get ready(): boolean {
    return this.isHost || this.samples.length >= 3;
  }
}
