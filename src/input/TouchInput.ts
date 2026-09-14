import type { InputState } from '../core/types';
import type { InputSource } from './InputManager';

type Action = 'left' | 'right' | 'jump' | 'restart';

/**
 * Controles tactiles.
 *
 * Van montados en pantalla completa, NO dentro del canvas: un telefono suele
 * ser ~2.1:1 y el juego es 16:9, asi que sobran barras negras a los costados
 * y ahi entran los pulgares sin tapar nada del mapa.
 *
 * El seguimiento se hace por hit-test contra el puntero (no por captura), asi
 * se puede deslizar el pulgar de izquierda a derecha sin levantarlo, que es
 * como la gente juega de verdad.
 */
export class TouchInput implements InputSource {
  readonly state: InputState = { left: false, right: false, jump: false };
  readonly root = document.createElement('div');

  private restart = false;
  private readonly pointers = new Map<number, Action | null>();
  private readonly buttons = new Map<Action, HTMLElement>();
  /** Rectangulos de los botones, cacheados: ver `actionAt`. */
  private hitboxes: { action: Action; rect: DOMRect }[] = [];

  constructor(parent: HTMLElement) {
    this.root.className = 'touch-controls';

    const pad = document.createElement('div');
    pad.className = 'touch-cluster touch-left';
    pad.append(this.makeButton('left', '◀'), this.makeButton('right', '▶'));

    const actions = document.createElement('div');
    actions.className = 'touch-cluster touch-right';
    actions.append(this.makeButton('jump', '▲'));

    this.root.append(pad, actions, this.makeButton('restart', '⟳', 'touch-restart'));
    parent.appendChild(this.root);

    this.root.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('resize', this.measure);
    window.addEventListener('orientationchange', this.measure);
    // Un gesto de dos dedos sobre los controles no debe hacer zoom.
    this.root.addEventListener('contextmenu', preventDefault);
  }

  private makeButton(action: Action, label: string, extraClass = ''): HTMLElement {
    const b = document.createElement('button');
    b.className = `touch-btn ${extraClass}`.trim();
    b.dataset.action = action;
    b.textContent = label;
    b.setAttribute('aria-label', action);
    b.tabIndex = -1;
    this.buttons.set(action, b);
    return b;
  }

  /** Se vuelve a medir al empezar un toque y al cambiar el tamano de pantalla. */
  private measure = (): void => {
    this.hitboxes = [...this.buttons].map(([action, el]) => ({
      action,
      rect: el.getBoundingClientRect(),
    }));
  };

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.hitboxes.length === 0) this.measure();
    this.pointers.set(e.pointerId, this.actionAt(e));
    this.sync();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, this.actionAt(e));
    this.sync();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.sync();
  };

  /**
   * Que boton hay bajo el dedo.
   *
   * Se compara contra rectangulos cacheados en vez de usar
   * document.elementFromPoint: ese metodo obliga al navegador a recalcular el
   * layout de la pagina entera, y con el pulgar apoyado se llamaria decenas de
   * veces por segundo. Los botones no se mueven durante una partida, asi que
   * alcanza con medirlos una vez.
   */
  private actionAt(e: PointerEvent): Action | null {
    for (const { action, rect } of this.hitboxes) {
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        return action;
      }
    }
    return null;
  }

  private sync(): void {
    const active = new Set<Action>();
    for (const a of this.pointers.values()) if (a) active.add(a);

    this.state.left = active.has('left');
    this.state.right = active.has('right');
    this.state.jump = active.has('jump');
    if (active.has('restart')) this.restart = true;

    for (const [action, el] of this.buttons) {
      el.classList.toggle('pressed', active.has(action));
    }
  }

  consumeRestart(): boolean {
    const r = this.restart;
    this.restart = false;
    return r;
  }

  destroy(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.measure);
    window.removeEventListener('orientationchange', this.measure);
    this.root.remove();
  }
}

function preventDefault(e: Event): void {
  e.preventDefault();
}

/**
 * Decide si mostrar controles tactiles.
 * `?touch=1` los fuerza en escritorio para poder probar el layout sin telefono.
 */
export function shouldUseTouch(): boolean {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}
