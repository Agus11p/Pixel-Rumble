import type { InputState } from '../core/types';
import type { InputSource } from './InputManager';

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyK']);
const RESTART_KEYS = new Set(['KeyR']);

export class KeyboardInput implements InputSource {
  readonly state: InputState = { left: false, right: false, jump: false };
  private restart = false;
  private readonly held = new Set<string>();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (!this.isGameKey(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
    if (RESTART_KEYS.has(e.code)) this.restart = true;
    this.sync();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.isGameKey(e.code)) return;
    e.preventDefault();
    this.held.delete(e.code);
    this.sync();
  };

  /** Si la ventana pierde el foco soltamos todo: evita quedarse corriendo solo. */
  private onBlur = (): void => {
    this.held.clear();
    this.sync();
  };

  private isGameKey(code: string): boolean {
    return (
      LEFT_KEYS.has(code) || RIGHT_KEYS.has(code) || JUMP_KEYS.has(code) || RESTART_KEYS.has(code)
    );
  }

  private sync(): void {
    this.state.left = this.anyHeld(LEFT_KEYS);
    this.state.right = this.anyHeld(RIGHT_KEYS);
    this.state.jump = this.anyHeld(JUMP_KEYS);
  }

  private anyHeld(keys: Set<string>): boolean {
    for (const k of keys) if (this.held.has(k)) return true;
    return false;
  }

  consumeRestart(): boolean {
    const r = this.restart;
    this.restart = false;
    return r;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
