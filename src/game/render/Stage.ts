import { Application, Container, TextureStyle } from 'pixi.js';
import { VIRTUAL_H, VIRTUAL_W } from '../../core/constants';
import { PALETTE } from './palette';

/**
 * Si es true, el canvas solo se escala por multiplos enteros (pixeles
 * perfectamente cuadrados) a costa de bandas negras grandes en telefonos.
 * Si es false, se escala a lo que entre y el navegador hace nearest-neighbor:
 * llena la pantalla y sigue viendose pixelado.
 *
 * Para el MVP movil conviene false; queda aca como interruptor unico.
 */
const INTEGER_SCALE = false;

/**
 * Superficie de dibujo del juego.
 *
 * El canvas mide SIEMPRE 480x270 pixeles reales. No se dibuja a la resolucion
 * de la pantalla: se dibuja chiquito y se agranda por CSS. Eso da tres cosas
 * gratis: pixel art nitido, coordenadas identicas en todos los dispositivos
 * (clave para el multijugador) y un costo de render ridiculo en telefonos.
 */
export class Stage {
  readonly app = new Application();
  /** Contenedor raiz del mundo, en coordenadas virtuales. */
  readonly world = new Container();
  /** Div que envuelve canvas + HUD, del tamano exacto del juego en pantalla. */
  readonly wrapper = document.createElement('div');

  private observer?: ResizeObserver;
  private ready = false;

  async init(parent: HTMLElement): Promise<void> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';

    await this.app.init({
      width: VIRTUAL_W,
      height: VIRTUAL_H,
      background: PALETTE.sky0,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
    });

    // El loop lo maneja Game: la simulacion necesita tick fijo, no el de Pixi.
    this.app.ticker.stop();

    this.wrapper.className = 'stage';
    this.wrapper.appendChild(this.app.canvas);
    parent.appendChild(this.wrapper);

    this.app.stage.addChild(this.world);

    this.ready = true;

    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(document.body);
  }

  private resize = (): void => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let scale = Math.min(vw / VIRTUAL_W, vh / VIRTUAL_H);
    if (INTEGER_SCALE && scale > 1) scale = Math.floor(scale);
    if (scale <= 0) return;

    const w = Math.round(VIRTUAL_W * scale);
    const h = Math.round(VIRTUAL_H * scale);
    this.wrapper.style.width = `${w}px`;
    this.wrapper.style.height = `${h}px`;
    this.wrapper.style.setProperty('--scale', String(scale));
  };

  /** El canvas real, para traducir coordenadas de pantalla a coordenadas del mapa. */
  get canvas(): HTMLCanvasElement | null {
    return this.ready ? this.app.canvas : null;
  }

  render(): void {
    if (!this.ready) return;
    this.app.renderer.render(this.app.stage);
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.observer?.disconnect();
    // StrictMode monta y desmonta dos veces: destruir una Application que
    // todavia no termino de inicializar revienta, asi que se comprueba.
    if (this.ready) {
      this.ready = false;
      this.app.destroy(true, { children: true });
    }
    this.wrapper.remove();
  }
}
