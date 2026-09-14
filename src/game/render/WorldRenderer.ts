import { Container, Graphics } from 'pixi.js';
import { MAX_FALL, PLAYER_H, PLAYER_W, VIRTUAL_H, VIRTUAL_W } from '../../core/constants';
import { objectParts, objectSize, objectType } from '../../core/objects/catalog';
import type { GameMap, PlacedObject, PlayerState, World } from '../../core/types';
import { PALETTE } from './palette';

/** Previsualizacion semitransparente de un objeto antes de confirmarlo (§16). */
export interface Ghost {
  type: string;
  x: number;
  y: number;
  rotation: 0 | 1;
  /** Verde si la posicion es valida, rojo si no. */
  valid: boolean;
  /** Fantasma del jugador local: se dibuja mas marcado que el de los demas. */
  own: boolean;
  /** Ya lo dejo en un lugar y solo falta confirmar. */
  anchored?: boolean;
}

/** Como se dibuja cada jugador. El color sale de la sala, no de la simulacion. */
export interface PlayerSkin {
  color: number;
  /** El jugador local lleva una flechita encima para no perderse de vista. */
  local: boolean;
}

interface PlayerView {
  container: Container;
  body: Graphics;
  face: Graphics;
  marker: Graphics;
}

/**
 * Dibuja el mundo. Todo provisional: formas geometricas, todavia sin sprites.
 *
 * El mapa se dibuja UNA sola vez (es estatico); por frame solo se mueve el
 * jugador. En 480x270 esto le sobra a cualquier telefono.
 */
export class WorldRenderer {
  private readonly background = new Graphics();
  private readonly terrain = new Graphics();
  private readonly goal = new Graphics();
  private readonly objectsLayer = new Graphics();
  private readonly ghostLayer = new Graphics();
  private readonly actors = new Container();
  private readonly views = new Map<string, PlayerView>();
  private skins = new Map<string, PlayerSkin>();

  private time = 0;

  private objectsSignature = '';

  constructor(private readonly root: Container) {
    root.addChild(
      this.background,
      this.terrain,
      this.objectsLayer,
      this.goal,
      this.actors,
      this.ghostLayer,
    );
  }

  /**
   * Dibuja los objetos colocados. Se rehace solo cuando la lista cambia: en
   * plena carrera no cambia nunca, asi que esto no cuesta nada por frame.
   */
  private syncObjects(objects: readonly PlacedObject[]): void {
    const signature = objects.map((o) => `${o.id}:${o.x},${o.y},${o.rotation}`).join('|');
    if (signature === this.objectsSignature) return;
    this.objectsSignature = signature;

    const g = this.objectsLayer;
    g.clear();
    for (const placed of objects) {
      const type = objectType(placed.type);
      if (!type) continue;
      for (const { part, x, y, w, h } of objectParts(placed)) {
        if (part.kind === 'hazard') {
          g.rect(x, y + h - 2, w, 2).fill(darken(type.color, 0.6));
          for (let sx = x; sx + 4 <= x + w; sx += 4) {
            g.poly([sx, y + h, sx + 2, y, sx + 4, y + h]).fill(type.color);
          }
        } else {
          g.rect(x, y, w, h).fill(type.color);
          g.rect(x, y, w, 1).fill(type.accent);
          if (part.kind === 'oneWay') {
            for (let sx = x + 2; sx < x + w - 2; sx += 6) {
              g.rect(sx, y + h, 2, 1).fill({ color: type.accent, alpha: 0.5 });
            }
          }
        }
      }
    }
  }

  /** Fantasmas de colocacion. Se redibujan por frame: son pocos y chiquitos. */
  setGhosts(ghosts: readonly Ghost[]): void {
    const g = this.ghostLayer;
    g.clear();
    for (const ghost of ghosts) {
      const type = objectType(ghost.type);
      if (!type) continue;
      const size = objectSize(type, ghost.rotation);
      const tint = ghost.valid ? 0x53e07a : 0xe4515b;
      // Fijado se ve casi solido; mientras se mueve, mas transparente.
      const alpha = ghost.own ? (ghost.anchored ? 0.8 : 0.5) : 0.25;

      g.rect(ghost.x, ghost.y, size.w, size.h).fill({ color: type.color, alpha });
      g.rect(ghost.x - 1, ghost.y - 1, size.w + 2, 1).fill({ color: tint, alpha: ghost.own ? 1 : 0.5 });
      g.rect(ghost.x - 1, ghost.y + size.h, size.w + 2, 1).fill({ color: tint, alpha: ghost.own ? 1 : 0.5 });
      g.rect(ghost.x - 1, ghost.y, 1, size.h).fill({ color: tint, alpha: ghost.own ? 1 : 0.5 });
      g.rect(ghost.x + size.w, ghost.y, 1, size.h).fill({ color: tint, alpha: ghost.own ? 1 : 0.5 });
    }
  }

  setSkins(skins: Map<string, PlayerSkin>): void {
    this.skins = skins;
    for (const [id, view] of this.views) this.paint(view, id);
  }

  /** Se llama al cargar o cambiar de mapa. */
  buildMap(map: GameMap): void {
    this.drawBackground();
    this.drawTerrain(map);
    this.drawGoal(map);
  }

  private drawBackground(): void {
    const g = this.background;
    g.clear();
    g.rect(0, 0, VIRTUAL_W, VIRTUAL_H).fill(PALETTE.sky0);
    g.rect(0, 90, VIRTUAL_W, VIRTUAL_H - 90).fill(PALETTE.sky1);
    g.rect(0, 170, VIRTUAL_W, VIRTUAL_H - 170).fill(PALETTE.sky2);

    // Estrellas fijas: profundidad barata, cero costo por frame.
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 48; i++) {
      const x = Math.floor(rand() * VIRTUAL_W);
      const y = Math.floor(rand() * 150);
      g.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha: 0.18 + rand() * 0.35 });
    }

    // Colinas del fondo.
    g.poly([0, 200, 70, 150, 150, 205, 240, 160, 330, 210, 420, 165, 480, 205, 480, 270, 0, 270])
      .fill({ color: PALETTE.hill, alpha: 0.55 });
  }

  private drawTerrain(map: GameMap): void {
    const g = this.terrain;
    g.clear();

    for (const s of map.solids) {
      // Los muros y el techo son limites invisibles: no se dibujan.
      if (s.x < 0 || s.x >= VIRTUAL_W || s.y < 0) continue;

      if (s.oneWay) {
        g.rect(s.x, s.y, s.w, s.h).fill(PALETTE.oneWay);
        g.rect(s.x, s.y, s.w, 2).fill(PALETTE.oneWayTop);
        for (let x = s.x + 2; x < s.x + s.w - 2; x += 6) {
          g.rect(x, s.y + s.h, 2, 1).fill({ color: PALETTE.oneWayTop, alpha: 0.5 });
        }
      } else {
        g.rect(s.x, s.y, s.w, s.h).fill(PALETTE.solid);
        g.rect(s.x, s.y, s.w, 2).fill(PALETTE.solidTop);
        g.rect(s.x, s.y + s.h - 2, s.w, 2).fill(PALETTE.solidShade);
      }
    }

    // Pinches: triangulos de 4px de base.
    for (const h of map.hazards) {
      g.rect(h.x, h.y + h.h - 2, h.w, 2).fill(PALETTE.hazardDark);
      for (let x = h.x; x + 4 <= h.x + h.w; x += 4) {
        g.poly([x, h.y + h.h, x + 2, h.y, x + 4, h.y + h.h]).fill(PALETTE.hazard);
      }
    }
  }

  private drawGoal(map: GameMap): void {
    const g = this.goal;
    const r = map.goal;
    g.clear();
    g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).fill({ color: PALETTE.goal, alpha: 0.18 });
    g.rect(r.x, r.y, r.w, r.h).fill(PALETTE.goalDark);
    g.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4).fill(PALETTE.goal);
    // Cuadros tipo bandera de meta.
    for (let y = r.y + 2; y < r.y + r.h - 2; y += 4) {
      for (let x = r.x + 2; x < r.x + r.w - 2; x += 4) {
        const odd = ((x - r.x) / 4 + (y - r.y) / 4) % 2 === 0;
        if (odd) g.rect(x, y, 4, 4).fill(PALETTE.goalDark);
      }
    }
    g.position.set(0, 0);
  }

  /** Personaje provisional: un bloque con ojos. Se reemplaza por sprites en F8. */
  private viewFor(id: string): PlayerView {
    const existing = this.views.get(id);
    if (existing) return existing;

    const container = new Container();
    const body = new Graphics();
    const face = new Graphics();
    const marker = new Graphics();
    container.addChild(body, face, marker);
    this.actors.addChild(container);

    const view: PlayerView = { container, body, face, marker };
    this.views.set(id, view);
    this.paint(view, id);
    return view;
  }

  private paint(view: PlayerView, id: string): void {
    const skin = this.skins.get(id);
    const color = skin?.color ?? PALETTE.player;
    const dark = darken(color, 0.55);

    view.body.clear();
    // Pivot abajo-centro para que el squash apoye en el piso.
    view.body.rect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, PLAYER_H).fill(color);
    view.body.rect(-PLAYER_W / 2, -2, PLAYER_W, 2).fill(dark);
    view.body.rect(-PLAYER_W / 2, -PLAYER_H, PLAYER_W, 1).fill(lighten(color, 0.45));

    view.face.clear();
    view.face.rect(0, -PLAYER_H + 4, 2, 2).fill(PALETTE.playerEye);
    view.face.rect(3, -PLAYER_H + 4, 2, 2).fill(PALETTE.playerEye);

    view.marker.clear();
    if (skin?.local) {
      view.marker.poly([-3, -PLAYER_H - 6, 3, -PLAYER_H - 6, 0, -PLAYER_H - 2]).fill(0xffffff);
    }
  }

  draw(world: World, prev: readonly PlayerState[], alpha: number, dtMs: number): void {
    this.time += dtMs;
    this.syncObjects(world.objects);

    const seen = new Set<string>();
    for (const p of world.players) {
      seen.add(p.id);
      const view = this.viewFor(p.id);
      const before = prev.find((q) => q.id === p.id) ?? p;

      // Interpolacion entre el tick anterior y el actual: el movimiento se ve
      // fluido aunque la pantalla vaya a 144 Hz y la simulacion a 60.
      const x = before.x + (p.x - before.x) * alpha;
      const y = before.y + (p.y - before.y) * alpha;
      view.container.position.set(Math.round(x + PLAYER_W / 2), Math.round(y + PLAYER_H));

      // Squash & stretch: pura sensacion, no afecta la fisica.
      let sy = 1;
      if (p.phase === 'racing' && !p.onGround) {
        sy = 1 + Math.min(Math.abs(p.vy) / MAX_FALL, 1) * 0.14 * (p.vy < 0 ? 1 : 0.8);
      }
      view.container.scale.set(p.facing / sy, sy);
      view.face.x = p.facing > 0 ? -1 : -4;

      // Los eliminados quedan como fantasmas: se ven, pero no estorban (§22).
      view.container.alpha = p.phase === 'dead' ? 0.3 : 1;
      view.marker.visible = p.phase === 'racing';
      view.container.zIndex = p.phase === 'racing' ? 1 : 0;
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.container.destroy({ children: true });
      this.views.delete(id);
    }

    // La meta late suavemente.
    this.goal.alpha = 0.85 + Math.sin(this.time / 260) * 0.15;
  }

  destroy(): void {
    for (const view of this.views.values()) view.container.destroy({ children: true });
    this.views.clear();
    this.root.removeChildren();
  }
}

function darken(color: number, amount: number): number {
  const r = Math.round(((color >> 16) & 0xff) * amount);
  const g = Math.round(((color >> 8) & 0xff) * amount);
  const b = Math.round((color & 0xff) * amount);
  return (r << 16) | (g << 8) | b;
}

function lighten(color: number, amount: number): number {
  const mix = (c: number): number => Math.round(c + (255 - c) * amount);
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}
