import type { InputState } from '../core/types';

/**
 * Fuente de input. Cada dispositivo (teclado, tactil, gamepad) implementa esto
 * y no sabe absolutamente nada del juego.
 */
export interface InputSource {
  readonly state: InputState;
  /** Pedido de reinicio pendiente (tecla R, boton, etc). */
  consumeRestart(): boolean;
  destroy(): void;
}

/**
 * Combina todas las fuentes en un unico InputState.
 *
 * Esta es la frontera de §31: de aca para adentro el juego solo ve
 * { left, right, jump }. Ningun KeyboardEvent ni TouchEvent cruza esta linea,
 * y por eso la misma logica sirve en PC, en telefono y del otro lado de la red.
 */
export class InputManager {
  readonly state: InputState = { left: false, right: false, jump: false };
  private readonly sources: InputSource[] = [];
  private restart = false;

  add(source: InputSource): void {
    this.sources.push(source);
  }

  /** Se llama una vez por frame, antes de correr los ticks. */
  update(): void {
    let left = false;
    let right = false;
    let jump = false;
    for (const s of this.sources) {
      left ||= s.state.left;
      right ||= s.state.right;
      jump ||= s.state.jump;
      if (s.consumeRestart()) this.restart = true;
    }
    this.state.left = left;
    this.state.right = right;
    this.state.jump = jump;
  }

  consumeRestart(): boolean {
    const r = this.restart;
    this.restart = false;
    return r;
  }

  destroy(): void {
    for (const s of this.sources) s.destroy();
    this.sources.length = 0;
  }
}
