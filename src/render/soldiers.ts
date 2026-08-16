import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import { SOLDIER_RADIUS } from '../sim/soldier';
import type { Battle } from '../sim/battle';

const TEAM_COLORS: { body: number; edge: number }[] = [
  { body: 0x3d6fb0, edge: 0x1e3a61 }, // player — blue
  { body: 0xb04040, edge: 0x5e1f1f }, // enemy — red
];

// One texture per team, drawn facing +x; sprites rotate to the soldier's facing.
function makeSoldierTexture(renderer: Renderer, team: number): Texture {
  const c = TEAM_COLORS[team] ?? TEAM_COLORS[0]!;
  const r = SOLDIER_RADIUS;
  const g = new Graphics()
    // weapon nub pointing forward so facing reads at a glance
    .poly([r + 5, 0, r - 2, -3.5, r - 2, 3.5])
    .fill(c.edge)
    .circle(0, 0, r)
    .fill(c.body)
    .stroke({ width: 1.5, color: c.edge })
    .circle(r * 0.3, 0, r * 0.35)
    .fill(c.edge);
  const texture = renderer.generateTexture({ target: g, resolution: 4 });
  g.destroy();
  return texture;
}

export class SoldierLayer {
  readonly container = new Container();
  private sprites = new Map<number, Sprite>();
  private textures: Texture[] = [];

  constructor(renderer: Renderer, battle: Battle) {
    this.textures = TEAM_COLORS.map((_, team) => makeSoldierTexture(renderer, team));
    for (const squad of battle.squads) {
      for (const s of squad.soldiers) {
        const sprite = new Sprite(this.textures[s.team]);
        sprite.anchor.set(0.5);
        this.sprites.set(s.id, sprite);
        this.container.addChild(sprite);
      }
    }
  }

  /** alpha = progress between the last two sim ticks, for smooth motion at any frame rate. */
  update(battle: Battle, alpha: number): void {
    for (const squad of battle.squads) {
      const routing = squad.state === 'routing';
      for (const s of squad.soldiers) {
        const sprite = this.sprites.get(s.id);
        if (!sprite) continue;
        sprite.position.set(
          s.prevX + (s.x - s.prevX) * alpha,
          s.prevY + (s.y - s.prevY) * alpha,
        );
        sprite.rotation = s.facing;
        sprite.alpha = routing ? 0.7 : 1;
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
