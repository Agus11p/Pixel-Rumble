/**
 * Aviso de "gira el dispositivo".
 *
 * La prioridad del MVP es horizontal (§30): en vertical el mapa de 16:9 queda
 * diminuto y los pulgares tapan la pantalla. En vez de degradar la experiencia,
 * se pide girar. Solo aparece en dispositivos tactiles.
 */
export class OrientationGuard {
  private readonly root = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.root.className = 'orientation-guard';
    this.root.innerHTML = `
      <div class="orientation-icon">▭</div>
      <p class="orientation-title">GIRÁ EL TELÉFONO</p>
      <p class="orientation-sub">PIXEL RUMBLE se juega en horizontal</p>
    `;
    parent.appendChild(this.root);

    this.update();
    window.addEventListener('resize', this.update);
    window.addEventListener('orientationchange', this.update);
  }

  private update = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('is-portrait', portrait);
  };

  destroy(): void {
    window.removeEventListener('resize', this.update);
    window.removeEventListener('orientationchange', this.update);
    this.root.remove();
  }
}
