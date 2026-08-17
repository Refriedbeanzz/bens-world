import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { Rng } from '../sim/rng';
import { CELL, GRID_W, GRID_H, type World } from '../sim/world';
import {
  crescent,
  grainLines,
  grime,
  OUTLINE,
  paintedShade,
  specular,
  wobblyCircle,
  wobblyLine,
} from './style';

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

const PALETTES: Record<
  string,
  { dark: number; light: number; dirt: number; grassDensity: number; bushDensity: number }
> = {
  meadow: { dark: 0x2e5122, light: 0x486e34, dirt: 0x6c5c3e, grassDensity: 0.26, bushDensity: 1 },
  steppe: { dark: 0x5c5730, light: 0x83773f, dirt: 0x76684a, grassDensity: 0.14, bushDensity: 0.5 },
  forest: { dark: 0x294a20, light: 0x3d6030, dirt: 0x5c4f38, grassDensity: 0.38, bushDensity: 1.6 },
};
const CLIFF_COLOR = 0x574e42;
const CLIFF_DARK = 0x3a332a;

// Scale a color's brightness by f (clamped per channel).
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

const LIGHT_A = -2.35;
const DARK_A = 0.79;

function isOpenGround(world: World, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return false;
  const i = cy * GRID_W + cx;
  return world.water[i] === 0 && world.cliff[i] === 0;
}

// --- Grass tufts: a handful of thin curved blades fanning from a base point. ---
function drawGrassTuft(
  g: Graphics,
  rng: Rng,
  x: number,
  y: number,
  scale: number,
  light: number,
  dark: number,
): void {
  const blades = rng.int(3, 5);
  for (let i = 0; i < blades; i++) {
    const a = rng.range(-1.3, 1.3) - Math.PI / 2; // fan upward-ish
    const len = scale * rng.range(3, 6);
    const bendX = Math.cos(a) * len * 0.5 + rng.range(-1, 1);
    const bendY = Math.sin(a) * len * 0.5;
    const tipX = Math.cos(a) * len;
    const tipY = Math.sin(a) * len;
    g.moveTo(x, y)
      .quadraticCurveTo(x + bendX, y + bendY, x + tipX, y + tipY)
      .stroke({ width: scale * 0.55, color: i % 2 === 0 ? dark : light, alpha: 0.85 });
  }
}

// --- Reeds: tall straight blades at a waterline, one topped with a cattail head. ---
function drawReedCluster(g: Graphics, rng: Rng, x: number, y: number): void {
  const blades = rng.int(3, 5);
  const REED = 0x5c6b34;
  const REED_DARK = 0x3e4a22;
  const CATTAIL = 0x5a3c26;
  for (let i = 0; i < blades; i++) {
    const lean = rng.range(-0.22, 0.22);
    const len = rng.range(14, 24);
    const baseX = x + rng.range(-3, 3);
    const baseY = y + rng.range(-3, 3);
    const tipX = baseX + lean * len;
    const tipY = baseY - len;
    g.moveTo(baseX, baseY)
      .quadraticCurveTo(baseX + lean * len * 0.5, baseY - len * 0.6, tipX, tipY)
      .stroke({ width: 0.7, color: i % 2 === 0 ? REED : REED_DARK, alpha: 0.9 });
    if (i === 0) {
      g.ellipse(tipX, tipY + len * 0.16, 1.1, 3.2).fill(CATTAIL);
    }
  }
}

// --- Bushes: a low, dense, multi-lobe shrub — trunk-less cousin of the tree canopy. ---
function drawBush(g: Graphics, rng: Rng, x: number, y: number, r: number, pal: { dark: number; light: number }): void {
  const lobes = rng.int(2, 3);
  const hue = rng.range(-0.1, 0.12);
  const base = lerpColor(pal.dark, pal.light, 0.45 + hue);
  g.ellipse(x + r * 0.15, y + r * 0.25, r * 1.05, r * 0.55).fill({ color: 0x000000, alpha: 0.16 }); // shadow
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = i === 0 ? 0 : r * 0.35;
    wobblyCircle(g, rng, x + Math.cos(a) * d, y + Math.sin(a) * d, r * rng.range(0.6, 0.85), base, OUTLINE, 0.8);
  }
  paintedShade(g, x, y, r * 0.9, LIGHT_A, DARK_A, 0xdff0c0, 0x0f1608);
  if (rng.next() < 0.5) {
    // a few berries or wildflower flecks for character
    const berryColor = rng.next() < 0.5 ? 0x8a2a2a : 0xd8cf6a;
    for (let i = 0; i < rng.int(2, 4); i++) {
      g.circle(x + rng.range(-r * 0.6, r * 0.6), y + rng.range(-r * 0.6, r * 0.6), 0.5).fill(berryColor);
    }
  }
}

// Bakes the whole battlefield ground into one texture: drawn once, cheap forever.
// Elevation reads through brightness (high = light) plus slope shading lit from
// the northwest; cliff cells draw as bare rock. Grass brush strokes, tufts,
// reeds, and bushes are baked in too — all static ground clutter.
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
        color = shade(color, bright * 0.86);
      }
      g.rect(cx * CELL, cy * CELL, CELL, CELL).fill(color);
    }
  }

  // Grass-blade brush pass: short angled strokes over open ground — a
  // painted dry-brush texture instead of flat noise-colored cells.
  const brush = new Rng(world.seed ^ 0x3d17c2);
  const brushCount = Math.round(GRID_W * GRID_H * 3.2);
  for (let i = 0; i < brushCount; i++) {
    const px = brush.range(0, world.widthPx);
    const py = brush.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    const a = brush.range(-1.9, -1.2);
    const len = brush.range(2.5, 5.5);
    const light = brush.next() > 0.5;
    g.moveTo(px, py)
      .lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len)
      .stroke({ width: 0.6, color: light ? pal.light : pal.dark, alpha: brush.range(0.1, 0.22) });
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

  // Grass tufts: small multi-blade clumps, density set by biome.
  const tuftRng = new Rng(world.seed ^ 0x1e5f0a);
  const tuftCount = Math.round(GRID_W * GRID_H * pal.grassDensity);
  for (let i = 0; i < tuftCount; i++) {
    const px = tuftRng.range(0, world.widthPx);
    const py = tuftRng.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    drawGrassTuft(g, tuftRng, px, py, tuftRng.range(0.7, 1.3), pal.light, pal.dark);
  }

  // Reeds: cluster along the boundary between dry ground and water.
  const reedRng = new Rng(world.seed ^ 0x8b3c41);
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      if (world.water[cy * GRID_W + cx] === 0) continue;
      const nearDry =
        isOpenGround(world, cx - 1, cy) ||
        isOpenGround(world, cx + 1, cy) ||
        isOpenGround(world, cx, cy - 1) ||
        isOpenGround(world, cx, cy + 1);
      if (!nearDry || reedRng.next() > 0.4) continue;
      const px = cx * CELL + reedRng.range(4, CELL - 4);
      const py = cy * CELL + reedRng.range(4, CELL - 4);
      drawReedCluster(g, reedRng, px, py);
    }
  }

  // Bushes: sparse low shrubs, avoiding trees/rocks so they don't overlap.
  const bushRng = new Rng(world.seed ^ 0x274a91);
  const bushCount = Math.round(18 * pal.bushDensity);
  for (let i = 0; i < bushCount; i++) {
    const px = bushRng.range(30, world.widthPx - 30);
    const py = bushRng.range(30, world.heightPx - 30);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    const r = bushRng.range(7, 12);
    const tooClose = world.obstacles.some((o) => {
      const dx = o.x - px;
      const dy = o.y - py;
      return dx * dx + dy * dy < (o.radius + r + 6) ** 2;
    });
    if (tooClose) continue;
    drawBush(g, bushRng, px, py, r, pal);
  }

  // Hill hachures: Inkarnate-style clustered contour ink strokes marking
  // raised ground. Flat terrain (plains, valley floors) gets none at all;
  // hachures thicken and stack toward a hilltop, tracing its contour lines
  // with one lighter "sunlit" stroke nearest the crest.
  const hachRng = new Rng(world.seed ^ 0x4c9e21);
  const HACH_INK = 0x362c1c;
  const HACH_LIGHT = 0xcfc088;
  const HACH_SPACING = 26;
  for (let py = HACH_SPACING / 2; py < world.heightPx; py += HACH_SPACING) {
    for (let px = HACH_SPACING / 2; px < world.widthPx; px += HACH_SPACING) {
      const jx = px + hachRng.range(-7, 7);
      const jy = py + hachRng.range(-7, 7);
      const cx = Math.floor(jx / CELL);
      const cy = Math.floor(jy / CELL);
      if (!isOpenGround(world, cx, cy)) continue;
      const h = world.heightAt(jx, jy);
      const hillT = Math.min(1, Math.max(0, (h - 0.56) / 0.3));
      if (hillT < 0.04) continue; // flat ground: no marks at all

      const d = 12;
      const gx = world.heightAt(jx + d, jy) - world.heightAt(jx - d, jy);
      const gy = world.heightAt(jx, jy + d) - world.heightAt(jx, jy - d);
      const glen = Math.hypot(gx, gy) || 0.0001;
      const ux = gx / glen; // points uphill
      const uy = gy / glen;
      const cxr = -uy; // contour direction (perpendicular to slope)
      const cyr = ux;

      const strokes = 2 + Math.round(hillT * 3);
      const len = 6 + hillT * 8;
      for (let i = 0; i < strokes; i++) {
        const off = i * 3.1; // each successive stroke sits further uphill
        const strokeLen = len * (1 - (i / strokes) * 0.4); // rings taper as they near the crest
        const ox = jx + ux * off;
        const oy = jy + uy * off;
        const x0 = ox - cxr * strokeLen * 0.5;
        const y0 = oy - cyr * strokeLen * 0.5;
        const x1 = ox + cxr * strokeLen * 0.5;
        const y1 = oy + cyr * strokeLen * 0.5;
        const bowX = ox + ux * 1.5;
        const bowY = oy + uy * 1.5;
        const isCrest = i === strokes - 1;
        g.moveTo(x0, y0)
          .quadraticCurveTo(bowX, bowY, x1, y1)
          .stroke({
            width: 0.7,
            color: isCrest ? HACH_LIGHT : HACH_INK,
            alpha: hillT * (isCrest ? 0.32 : 0.4),
          });
      }
    }
  }

  const texture = RenderTexture.create({ width: world.widthPx, height: world.heightPx });
  renderer.render({ container: g, target: texture });
  g.destroy();
  return new Sprite(texture);
}

const TREE_CANOPY_DARK = 0x223e1a;
const TREE_CANOPY_LIGHT = 0x4c7238;
const CONIFER_DARK = 0x1c3524;
const CONIFER_LIGHT = 0x2f5236;
const BARK = 0x4a3520;
const BARK_DARK = 0x2e2010;
const ROCK_COOL = 0x767066;
const ROCK_WARM = 0x817259;
const ROCK_DARK_COOL = 0x4c473f;
const ROCK_DARK_WARM = 0x554a37;
const MOSS = 0x4a5c2a;
const SHADOW_COL = 0x000000;

type TreeTier = 'small' | 'medium' | 'large';

function treeTier(r: number): TreeTier {
  return r > 25 ? 'large' : r > 17 ? 'medium' : 'small';
}

// A jagged wobbly ring for conifer canopy tiers — spiky needle silhouette
// instead of a smooth round lobe.
function conifer(g: Graphics, rng: Rng, cx: number, cy: number, r: number, color: number): void {
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const tr = r * (1 - t * 0.26);
    const ty = cy - t * r * 0.22;
    const spikes = 10;
    const pts: number[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = tr * (i % 2 === 0 ? 1 : 0.7) * (1 + rng.range(-0.06, 0.06));
      pts.push(cx + Math.cos(a) * rr, ty + Math.sin(a) * rr * 0.85);
    }
    g.poly(pts).fill(shade(color, 1 - t * 0.08)).stroke({ width: 0.8, color: OUTLINE, alpha: 0.7 });
  }
}

function drawTree(g: Graphics, rng: Rng, x: number, y: number, r: number): void {
  const tier = treeTier(r);
  const isConifer = rng.next() < 0.28;
  const hue = rng.range(-0.08, 0.1);

  // Root flare / trunk peek at the base, under the canopy — the only part
  // of a trunk that reads from directly above.
  const trunkR = tier === 'large' ? r * 0.22 : tier === 'medium' ? 0.16 * r : 0.11 * r;
  wobblyCircle(g, rng, x, y, trunkR, BARK, BARK_DARK, 0.8);
  if (tier === 'large') {
    const flares = rng.int(4, 6);
    for (let i = 0; i < flares; i++) {
      const a = (i / flares) * Math.PI * 2 + rng.range(-0.2, 0.2);
      wobblyLine(g, rng, x, y, x + Math.cos(a) * trunkR * 1.8, y + Math.sin(a) * trunkR * 1.8, 1.1, BARK_DARK);
    }
  }

  if (isConifer) {
    conifer(g, rng, x, y, r, lerpColor(CONIFER_DARK, CONIFER_LIGHT, 0.5 + hue));
    paintedShade(g, x, y - r * 0.15, r * 0.95, LIGHT_A, DARK_A, 0xcfe0b0, SHADOW_COL);
    return;
  }

  // Deciduous: multi-lobe canopy, more lobes on bigger/older trees.
  const lobes = tier === 'small' ? 2 : tier === 'medium' ? 3 : 5;
  const base = lerpColor(TREE_CANOPY_DARK, TREE_CANOPY_LIGHT, 0.5 + hue);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : r * rng.range(0.25, 0.42);
    const lr = r * (i === 0 ? rng.range(0.75, 0.95) : rng.range(0.5, 0.72));
    const lobeHue = hue + rng.range(-0.05, 0.05);
    wobblyCircle(
      g,
      rng,
      x + Math.cos(a) * d,
      y + Math.sin(a) * d,
      lr,
      lerpColor(TREE_CANOPY_DARK, TREE_CANOPY_LIGHT, 0.5 + lobeHue),
      OUTLINE,
      0.9,
    );
  }
  paintedShade(g, x, y, r * 0.95, LIGHT_A, DARK_A, 0xd8ecb0, SHADOW_COL);
  crescent(g, x, y, r * 0.9, LIGHT_A, 1.0, r * 0.3, base, 0.12); // soft canopy-color bounce
  grainLines(g, rng, x - r * 0.1, y, r * 0.35, rng.range(0, Math.PI), r * 1.4, 5, TREE_CANOPY_DARK, 0.12, 0.4);
  if (tier !== 'small' && rng.next() < 0.7) {
    grime(g, rng, x, y, r * 0.85, 3, [0x6a5030, 0x8a7038]); // a few dry/autumn leaf flecks
  }
}

function drawBoulder(g: Graphics, rng: Rng, x: number, y: number, r: number): void {
  const warm = rng.next();
  const base = lerpColor(ROCK_COOL, ROCK_WARM, warm);
  const darkBase = lerpColor(ROCK_DARK_COOL, ROCK_DARK_WARM, warm);

  const sides = rng.int(7, 10);
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = r * rng.range(0.62, 1.08);
    points.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.poly(points).fill(base).stroke({ width: 1.2, color: darkBase });
  paintedShade(g, x, y, r * 0.95, LIGHT_A, DARK_A, 0xf0ece0, SHADOW_COL);

  // facet lines: a couple of straight chords suggesting a fractured, angular surface
  for (let i = 0; i < rng.int(2, 3); i++) {
    const a0 = rng.range(0, Math.PI * 2);
    const a1 = a0 + rng.range(1.4, 2.6);
    const r0 = r * rng.range(0.3, 0.8);
    const r1 = r * rng.range(0.3, 0.8);
    g.moveTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0)
      .lineTo(x + Math.cos(a1) * r1, y + Math.sin(a1) * r1)
      .stroke({ width: 0.6, color: darkBase, alpha: 0.55 });
  }

  // moss on the shadow side — damp, shaded stone grows lichen
  if (rng.next() < 0.75) {
    const ma = DARK_A + rng.range(-0.4, 0.4);
    grime(g, rng, x + Math.cos(ma) * r * 0.4, y + Math.sin(ma) * r * 0.4, r * 0.55, rng.int(4, 7), [
      MOSS,
      0x5c6e34,
      0x3a4620,
    ]);
  }

  // occasional wet/polished glint on the lit face
  if (rng.next() < 0.35) {
    specular(g, x + Math.cos(LIGHT_A) * r * 0.35, y + Math.sin(LIGHT_A) * r * 0.35, r * 0.14, 0.4);
  }

  // satellite pebbles at the base of bigger boulders
  if (r > 16 && rng.next() < 0.6) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = r * rng.range(0.8, 1.15);
      const pr = r * rng.range(0.15, 0.3);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      const pts: number[] = [];
      const psides = rng.int(5, 6);
      for (let j = 0; j < psides; j++) {
        const pa = (j / psides) * Math.PI * 2;
        pts.push(px + Math.cos(pa) * pr * rng.range(0.75, 1.05), py + Math.sin(pa) * pr * rng.range(0.75, 1.05));
      }
      g.poly(pts).fill(base).stroke({ width: 0.7, color: darkBase });
    }
  }
}

export function buildObstacleLayer(world: World): Container {
  const layer = new Container();
  const shadows = new Graphics();
  const bodies = new Graphics();
  const rng = new Rng(world.seed ^ 0x77aa11);

  for (const o of world.obstacles) {
    shadows
      .ellipse(o.x + o.radius * 0.25, o.y + o.radius * 0.3, o.radius * 1.05, o.radius * 0.6)
      .fill({ color: SHADOW_COL, alpha: 0.2 });
  }

  for (const o of world.obstacles) {
    if (o.kind === 'tree') drawTree(bodies, rng, o.x, o.y, o.radius);
    else drawBoulder(bodies, rng, o.x, o.y, o.radius);
  }

  layer.addChild(shadows, bodies);
  return layer;
}
