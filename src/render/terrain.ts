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

const PALETTES: Record<string, { dark: number; light: number; dirt: number }> = {
  meadow: { dark: 0x3f6b2f, light: 0x5d8f43, dirt: 0x8a7550 },
  steppe: { dark: 0x7a7440, light: 0xa89a58, dirt: 0x9a8a60 },
  forest: { dark: 0x38622c, light: 0x527f3d, dirt: 0x7a6a4a },
};
const CLIFF_COLOR = 0x6e6254;
const CLIFF_DARK = 0x4c4339;

// Scale a color's brightness by f (clamped per channel).
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

// Bakes the whole battlefield ground into one texture: drawn once, cheap forever.
// Elevation reads through brightness (high = light) plus slope shading lit from
// the northwest; cliff cells draw as bare rock.
export function buildTerrainSprite(renderer: Renderer, world: World): Sprite {
  const rng = new Rng(world.seed ^ 0x9e3779b9);
  const grassNoise = makeNoise(rng, 12, 8);
  const dirtNoise = makeNoise(rng, 9, 6);
  const speckle = new Rng(world.seed ^ 0x51ab3c);
  const pal = PALETTES[world.spec.biome] ?? PALETTES.meadow!;

  const heightOf = (cx: number, cy: number): number =>
    world.height[
      Math.min(GRID_H - 1, Math.max(0, cy)) * GRID_W + Math.min(GRID_W - 1, Math.max(0, cx))
    ]!;

  const g = new Graphics();
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const u = cx / GRID_W;
      const v = cy / GRID_H;
      const h = heightOf(cx, cy);
      const sun = Math.min(1.22, Math.max(0.78, 1 + (heightOf(cx - 1, cy - 1) - heightOf(cx + 1, cy + 1)) * 2.2));
      const bright = (0.82 + h * 0.36) * sun;

      let color: number;
      const water = world.water[cy * GRID_W + cx];
      if (water === 2) {
        color = shade(lerpColor(0x1d3c58, 0x2a5070, grassNoise(u, v)), 0.95);
      } else if (water === 1) {
        color = shade(lerpColor(0x3f6e80, 0x568897, grassNoise(u, v)), 1.0);
      } else if (world.cliff[cy * GRID_W + cx] === 1) {
        color = shade(lerpColor(CLIFF_DARK, CLIFF_COLOR, speckle.next()), 0.75 + h * 0.45);
      } else {
        color = lerpColor(pal.dark, pal.light, grassNoise(u, v));
        const d = dirtNoise(u, v);
        if (d > 0.6) color = lerpColor(color, pal.dirt, Math.min(1, (d - 0.6) / 0.22) * 0.85);
        color = lerpColor(color, speckle.next() > 0.5 ? pal.light : pal.dark, 0.11);
        color = shade(color, bright * 0.96);
      }
      g.rect(cx * CELL, cy * CELL, CELL, CELL).fill(color);
    }
  }

  // Fine grit pass: scattered pebbles, dirt flecks, and worn patches at a
  // sub-cell scale so the ground reads rough up close, not like flat tiles.
  const grit = new Rng(world.seed ^ 0x6a12f3);
  const gritCount = Math.round(GRID_W * GRID_H * 2.4);
  for (let i = 0; i < gritCount; i++) {
    const px = grit.range(0, world.widthPx);
    const py = grit.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (world.water[cy * GRID_W + cx] || world.cliff[cy * GRID_W + cx]) continue;
    const dark = grit.next() > 0.35;
    const size = grit.range(0.5, 1.8);
    g.circle(px, py, size).fill({
      color: dark ? pal.dirt : pal.light,
      alpha: grit.range(0.08, dark ? 0.22 : 0.14),
    });
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
