import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { BLOOD, BLOOD_DARK, splat } from './style';
import { Rng } from '../sim/rng';
import type { PartSet } from './soldiers';

// The gore layer: blood spurts on every wound, spreading pools, and a static
// sprawled corpse for every death that stays on the field all battle.
// Blood accumulates into a baked texture so ten thousand stains cost one sprite.

const MAX_CORPSES = 1400;
const BAKE_AFTER = 220; // primitives drawn into the live graphics before baking

interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

export class GoreLayer {
  readonly container = new Container();
  private readonly bloodRT: RenderTexture;
  private readonly bloodSprite: Sprite;
  private readonly bloodLive = new Graphics();
  private readonly corpses = new Container();
  private readonly droplets: Droplet[] = [];
  private readonly rng = new Rng(0xb100d);
  private liveCount = 0;

  constructor(
    private readonly renderer: Renderer,
    widthPx: number,
    heightPx: number,
  ) {
    this.bloodRT = RenderTexture.create({ width: widthPx, height: heightPx });
    this.bloodSprite = new Sprite(this.bloodRT);
    this.container.addChild(this.bloodSprite, this.bloodLive, this.corpses);
  }

  /** A wound: a short spray of droplets plus an immediate small stain. */
  addHitBlood(x: number, y: number, facing: number): void {
    const rng = this.rng;
    const n = 2 + Math.floor(rng.next() * 3);
    for (let i = 0; i < n; i++) {
      const a = facing + Math.PI + rng.range(-1.1, 1.1); // spray away from the blow
      const sp = rng.range(18, 65);
      this.droplets.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rng.range(0.12, 0.3),
        size: rng.range(0.8, 1.9),
      });
    }
    splat(this.bloodLive, rng, x + rng.range(-2, 2), y + rng.range(-2, 2), rng.range(1.2, 2.6), BLOOD, 0.5);
    this.liveCount++;
  }

  /** A death: a big pool and a static sprawled corpse built from the unit's own art. */
  addDeath(x: number, y: number, facing: number, parts: PartSet | undefined): void {
    const rng = this.rng;
    splat(this.bloodLive, rng, x, y, rng.range(4.5, 8), BLOOD, 0.7);
    splat(this.bloodLive, rng, x + rng.range(-4, 4), y + rng.range(-4, 4), rng.range(2, 4), BLOOD_DARK, 0.6);
    this.liveCount += 2;

    if (parts) {
      const corpse = new Container();
      const body = new Sprite(parts.body.tex);
      body.anchor.set(parts.body.ax, parts.body.ay);
      const hl = new Sprite(parts.handL.tex);
      hl.anchor.set(parts.handL.ax, parts.handL.ay);
      const hr = new Sprite(parts.handR.tex);
      hr.anchor.set(parts.handR.ax, parts.handR.ay);
      // Sprawl: limbs flung at broken angles, weapon dropped beside the body.
      hl.position.set(rng.range(-6, 2), rng.range(-9, -3));
      hl.rotation = rng.range(-2.4, 2.4);
      hr.position.set(rng.range(-6, 2), rng.range(3, 9));
      hr.rotation = rng.range(-2.4, 2.4);
      corpse.addChild(body, hl, hr);
      corpse.position.set(x, y);
      corpse.rotation = facing + rng.range(-2.6, 2.6);
      corpse.alpha = 0.92;
      corpse.tint = 0xbdb2a4; // the pallor of the dead
      this.corpses.addChild(corpse);
      if (this.corpses.children.length > MAX_CORPSES) {
        this.corpses.children[0]!.destroy({ children: true });
      }
    }
  }

  update(frameDt: number): void {
    // Flying droplets land as stains.
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i]!;
      d.x += d.vx * frameDt;
      d.y += d.vy * frameDt;
      d.life -= frameDt;
      if (d.life <= 0) {
        splat(this.bloodLive, this.rng, d.x, d.y, d.size, BLOOD, 0.55);
        this.liveCount++;
        this.droplets.splice(i, 1);
      }
    }
    // Bake accumulated stains into the persistent texture and clear the live layer.
    if (this.liveCount >= BAKE_AFTER) {
      this.renderer.render({ container: this.bloodLive, target: this.bloodRT, clear: false });
      this.bloodLive.clear();
      this.liveCount = 0;
    }
  }
}
