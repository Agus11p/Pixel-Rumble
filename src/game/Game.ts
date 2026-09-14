import { InputManager } from '../input/InputManager';
import { KeyboardInput } from '../input/KeyboardInput';
import { TouchInput, shouldUseTouch } from '../input/TouchInput';
import type { GameDriver } from './drivers';
import { LocalDriver } from './drivers';
import { Hud } from './Hud';
import { Stage } from './render/Stage';
import type { Ghost, PlayerSkin } from './render/WorldRenderer';
import { WorldRenderer } from './render/WorldRenderer';

export interface GameOptions {
  /** De donde sale el estado del mundo. Por defecto, partida local. */
  driver?: GameDriver;
  /** Colores de cada jugador. En local hay uno solo y se usa el naranja. */
  skins?: Map<string, PlayerSkin>;
  /** El HUD propio del modo local; online lo dibuja React encima. */
  hud?: boolean;
}

/**
 * Orquesta simulacion, render e input.
 *
 * La regla de oro: la simulacion avanza SIEMPRE en pasos fijos de 1/60 s, pase
 * lo que pase con el framerate, y el render interpola entre el tick anterior y
 * el actual. Eso es lo que permite que todos los clientes de una carrera online
 * lleguen al mismo resultado en el mismo tick.
 */
export class Game {
  private readonly stage = new Stage();
  private readonly input = new InputManager();
  private readonly driver: GameDriver;
  private readonly useHud: boolean;
  private readonly skins: Map<string, PlayerSkin>;

  private renderer?: WorldRenderer;
  private hud?: Hud;

  private lastFrame = 0;
  private rafId = 0;
  private fps = 0;
  private showDebug = false;

  constructor(options: GameOptions = {}) {
    this.driver = options.driver ?? new LocalDriver();
    this.useHud = options.hud ?? true;
    this.skins = options.skins ?? new Map([['local', { color: 0xffb03b, local: true }]]);
  }

  async start(parent: HTMLElement): Promise<void> {
    await this.stage.init(parent);
    this.renderer = new WorldRenderer(this.stage.world);
    this.renderer.buildMap(this.driver.world.map);
    this.renderer.setSkins(this.skins);
    if (this.useHud) this.hud = new Hud(this.stage.wrapper);

    this.input.add(new KeyboardInput());
    if (shouldUseTouch()) {
      document.body.classList.add('has-touch');
      // Los controles cuelgan de <body>, no del canvas: necesitan las barras
      // laterales que el letterbox deja libres.
      this.input.add(new TouchInput(document.body));
    }
    window.addEventListener('keydown', this.onDebugKey);

    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  /** Permite cambiar los colores cuando la sala ya esta armada. */
  setSkins(skins: Map<string, PlayerSkin>): void {
    this.renderer?.setSkins(skins);
  }

  /** Previsualizaciones de colocacion, propias y de los demas. */
  setGhosts(ghosts: readonly Ghost[]): void {
    this.renderer?.setGhosts(ghosts);
  }

  /**
   * Rectangulo del canvas en pantalla. Lo necesita la fase de colocacion para
   * traducir donde toca el dedo a coordenadas del mapa.
   */
  canvasRect(): DOMRect | null {
    return this.stage.canvas?.getBoundingClientRect() ?? null;
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    this.fps += (1000 / Math.max(elapsed, 1) - this.fps) * 0.1;

    this.input.update();
    if (this.input.consumeRestart()) this.driver.restart();

    this.driver.update(this.input.state, elapsed);

    this.renderer?.draw(this.driver.world, this.driver.prev, this.driver.alpha, elapsed);
    this.hud?.update(this.driver.world, this.fps, this.showDebug);
    this.stage.render();
  };

  /** Herramienta de desarrollo, fuera del InputManager a proposito. */
  private onDebugKey = (e: KeyboardEvent): void => {
    if (e.code === 'Backquote') {
      e.preventDefault();
      this.showDebug = !this.showDebug;
    }
  };

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onDebugKey);
    document.body.classList.remove('has-touch');
    this.input.destroy();
    this.hud?.destroy();
    this.driver.destroy();
    this.stage.destroy();
  }
}
