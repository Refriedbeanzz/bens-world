import { Graphics, Texture, type Renderer } from 'pixi.js';
import { Rng } from '../sim/rng';

/** A small tileable speckle texture — multiply-blended over the whole scene for film grain. */
export function buildGrainTexture(renderer: Renderer, size = 128): Texture {
  const g = new Graphics();
  const rng = new Rng(0x9a1a1a);
  const count = Math.round(size * size * 0.55);
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const dark = rng.next() > 0.25;
    g.rect(x, y, 1, 1).fill({
      color: dark ? 0x000000 : 0x3a2f22,
      alpha: rng.range(0.05, dark ? 0.4 : 0.22),
    });
  }
  const tex = renderer.generateTexture({ target: g, resolution: 1 });
  g.destroy();
  return tex;
}
