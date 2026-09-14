import { TICK_RATE } from '../core/constants';
import type { World } from '../core/types';

/**
 * HUD provisional en DOM, encima del canvas.
 *
 * Va en DOM y no en Pixi porque a 480x270 cualquier texto dibujado en el canvas
 * queda ilegible. El div se escala junto con el canvas mediante la variable CSS
 * --scale, asi que ocupa siempre la misma proporcion de pantalla.
 */
export class Hud {
  readonly root = document.createElement('div');
  private readonly timer = document.createElement('div');
  private readonly message = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly debug = document.createElement('pre');
  /** Ultimo texto escrito en cada nodo: escribir en el DOM sin necesidad cuesta. */
  private lastTimer = '';
  private lastMessage = '';

  constructor(parent: HTMLElement) {
    this.root.className = 'hud';

    this.timer.className = 'hud-timer';
    this.message.className = 'hud-message';
    this.hint.className = 'hud-hint';
    this.hint.textContent = '← →  mover     ESPACIO  saltar     R  reiniciar';
    this.debug.className = 'hud-debug';
    this.debug.hidden = true;

    this.root.append(this.timer, this.message, this.hint, this.debug);
    parent.appendChild(this.root);
  }

  update(world: World, fps: number, showDebug: boolean): void {
    const p = world.players[0];
    if (!p) return;
    const endedTick = p.endTick >= 0 ? p.endTick : world.tick;
    const timer = formatTime(endedTick / TICK_RATE);
    if (timer !== this.lastTimer) {
      this.lastTimer = timer;
      this.timer.textContent = timer;
    }

    const message =
      p.phase === 'dead'
        ? '<span class="dead">CAÍSTE</span><small>R para reiniciar</small>'
        : p.phase === 'finished'
          ? `<span class="win">¡META!</span><small>${formatTime(p.endTick / TICK_RATE)} · R para reiniciar</small>`
          : '';
    if (message !== this.lastMessage) {
      this.lastMessage = message;
      this.message.innerHTML = message;
      this.message.hidden = message === '';
    }

    this.debug.hidden = !showDebug;
    if (showDebug) {
      this.debug.textContent =
        `fps    ${fps.toFixed(0)}\n` +
        `tick   ${world.tick}\n` +
        `pos    ${p.x.toFixed(2)} ${p.y.toFixed(2)}\n` +
        `vel    ${p.vx.toFixed(1)} ${p.vy.toFixed(1)}\n` +
        `suelo  ${p.onGround ? 'si' : 'no'}\n` +
        `coyote ${p.coyote}  buffer ${p.jumpBuffer}\n` +
        `anim   ${p.anim}`;
    }
  }

  destroy(): void {
    this.root.remove();
  }
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}
