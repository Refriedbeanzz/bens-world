import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Battle } from '../sim/battle';
import type { UnitType } from '../sim/unittype';

const TEAM_COLORS: { body: number; edge: number }[] = [
  { body: 0x3d6fb0, edge: 0x1e3a61 }, // player — blue
  { body: 0xb04040, edge: 0x5e1f1f }, // enemy — red
];

// One texture per (team, unit type), drawn facing +x; sprites rotate to facing.
function makeSoldierTexture(renderer: Renderer, team: number, type: UnitType): Texture {
  const c = TEAM_COLORS[team] ?? TEAM_COLORS[0]!;
  const r = type.radius;
  const g = new Graphics();

  if (type.mounted) {
    // Horse: an ellipse along the facing, rider dot on top. Knights darker/heavier.
    const heavy = type.key === 'knight';
    g.ellipse(0, 0, r * 1.55, r * 0.95).fill(heavy ? c.edge : c.body);
    if (heavy) g.ellipse(0, 0, r * 1.15, r * 0.7).fill(c.body);
    g.poly([r * 2.1, 0, r * 1.2, -3.5, r * 1.2, 3.5]).fill(c.edge); // lance/head
    g.circle(-r * 0.1, 0, r * 0.55).fill(c.edge); // rider
  } else {
    switch (type.key) {
      case 'pikeman':
        // long thin pike
        g.rect(r - 2, -1, r + 16, 2).fill(c.edge);
        g.poly([r * 2 + 16, 0, r * 2 + 10, -2.5, r * 2 + 10, 2.5]).fill(0x888880);
        break;
      case 'archer':
        // bow: an arc held out front
        g.arc(r * 0.4, 0, r * 0.95, -1.15, 1.15).stroke({ width: 1.8, color: 0x7a5c38 });
        break;
      case 'crossbowman':
        // crossbow: short stock + crossbar
        g.rect(r - 2, -1.2, 8, 2.4).fill(0x7a5c38);
        g.rect(r + 3, -4.5, 1.8, 9).fill(0x7a5c38);
        break;
      default:
        // sword nub
        g.poly([r + 5, 0, r - 2, -3.5, r - 2, 3.5]).fill(c.edge);
    }
    g.circle(0, 0, r).fill(c.body).stroke({ width: 1.5, color: c.edge });
    g.circle(r * 0.3, 0, r * 0.35).fill(c.edge);
  }

  const texture = renderer.generateTexture({ target: g, resolution: 4 });
  g.destroy();
  return texture;
}

export class SoldierLayer {
  readonly container = new Container();
  private sprites = new Map<number, Sprite>();
  private textures = new Map<string, Texture>();

  constructor(renderer: Renderer, battle: Battle) {
    for (const squad of battle.squads) {
      const key = `${squad.team}:${squad.unitType.key}`;
      let texture = this.textures.get(key);
      if (!texture) {
        texture = makeSoldierTexture(renderer, squad.team, squad.unitType);
        this.textures.set(key, texture);
      }
      for (const s of squad.soldiers) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        this.sprites.set(s.id, sprite);
        this.container.addChild(sprite);
      }
    }
  }

  /** alpha = progress between the last two sim ticks, for smooth motion at any frame rate. */
  update(battle: Battle, alpha: number): void {
    for (const squad of battle.squads) {
      // Broken men fade; men leaving the field for good fade harder.
      const alpha_ = squad.state === 'steady' ? 1 : squad.state === 'routing' ? 0.75 : 0.45;
      for (const s of squad.soldiers) {
        const sprite = this.sprites.get(s.id);
        if (!sprite) continue;
        sprite.position.set(
          s.prevX + (s.x - s.prevX) * alpha,
          s.prevY + (s.y - s.prevY) * alpha,
        );
        sprite.rotation = s.facing;
        sprite.alpha = alpha_;
      }
    }
  }

  removeById(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }
  }
}

/** Redraws all missiles each frame: shadow on the ground track, shaft lifted on a visual arc. */
export function drawProjectiles(g: Graphics, battle: Battle, alpha: number): void {
  g.clear();
  for (const p of battle.projectiles) {
    const x = p.prevX + (p.x - p.prevX) * alpha;
    const y = p.prevY + (p.y - p.prevY) * alpha;
    const k = Math.min(1, (p.t + alpha / 30) / p.flightTime);
    const lift = p.arcHeight * 4 * k * (1 - k);
    const dx = p.tx - p.sx;
    const dy = p.ty - p.sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * 5;
    const uy = (dy / len) * 5;
    g.ellipse(x, y, 2.2, 1.4).fill({ color: 0x000000, alpha: 0.18 });
    g.moveTo(x - ux, y - uy - lift)
      .lineTo(x + ux, y + uy - lift)
      .stroke({ width: 1.6, color: 0x4a3b26 });
  }
}
