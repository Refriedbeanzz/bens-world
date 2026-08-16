import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { Rng } from '../sim/rng';
import { CELL, GRID_W, GRID_H, type World } from '../sim/world';

// Smooth value noise: random values on a coarse lattice, bilinearly interpolated.
// Gives the grass gentle patchiness instead of per-tile static.
function makeNoise(rng: Rng, latticeW: number, latticeH: number): (u: number, v: number) => number {
  const lattice = new Float32Array((latticeW + 1) * (latticeH + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const at = (x: number, y: number) => lattice[y * (latticeW + 1) + x] ?? 0;
  return (u, v) => {
    const x = Math.min(u * latticeW, latticeW - 0.0001);
    const y = Math.min(v * latticeH, latticeH - 0.0001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const GRASS_DARK = 0x3f6b2f;
const GRASS_LIGHT = 0x5d8f43;
const DIRT = 0x8a7550;

// Bakes the whole battlefield ground into one texture: drawn once, cheap forever.
export function buildTerrainSprite(renderer: Renderer, world: World): Sprite {
  const rng = new Rng(world.seed ^ 0x9e3779b9);
  const grassNoise = makeNoise(rng, 12, 8);
  const dirtNoise = makeNoise(rng, 9, 6);
  const speckle = new Rng(world.seed ^ 0x51ab3c);

  const g = new Graphics();
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const u = cx / GRID_W;
      const v = cy / GRID_H;
      let color = lerpColor(GRASS_DARK, GRASS_LIGHT, grassNoise(u, v));
      const d = dirtNoise(u, v);
      if (d > 0.68) color = lerpColor(color, DIRT, Math.min(1, (d - 0.68) / 0.18) * 0.8);
      color = lerpColor(color, speckle.next() > 0.5 ? GRASS_LIGHT : GRASS_DARK, 0.06);
      g.rect(cx * CELL, cy * CELL, CELL, CELL).fill(color);
    }
  }

  const texture = RenderTexture.create({ width: world.widthPx, height: world.heightPx });
  renderer.render({ container: g, target: texture });
  g.destroy();
  return new Sprite(texture);
}

const TREE_CANOPY = 0x2e5222;
const TREE_CANOPY_LIT = 0x40682e;
const ROCK = 0x8c8c84;
const ROCK_DARK = 0x6e6e66;
const SHADOW = 0x000000;

export function buildObstacleLayer(world: World): Container {
  const layer = new Container();
  const shadows = new Graphics();
  const bodies = new Graphics();
  const rng = new Rng(world.seed ^ 0x77aa11);

  for (const o of world.obstacles) {
    shadows.ellipse(o.x + o.radius * 0.25, o.y + o.radius * 0.3, o.radius * 1.05, o.radius * 0.6)
      .fill({ color: SHADOW, alpha: 0.18 });
  }

  for (const o of world.obstacles) {
    if (o.kind === 'tree') {
      bodies.circle(o.x, o.y, o.radius).fill(TREE_CANOPY);
      // A lighter lobe up-left fakes sunlight on the canopy.
      bodies.circle(o.x - o.radius * 0.25, o.y - o.radius * 0.25, o.radius * 0.62).fill(TREE_CANOPY_LIT);
    } else {
      const points: number[] = [];
      const sides = rng.int(6, 8);
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const r = o.radius * rng.range(0.75, 1.05);
        points.push(o.x + Math.cos(angle) * r, o.y + Math.sin(angle) * r);
      }
      bodies.poly(points).fill(ROCK).stroke({ width: 2, color: ROCK_DARK });
    }
  }

  layer.addChild(shadows, bodies);
  return layer;
}
