import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { Rng } from '../sim/rng';
import { CELL, GRID_W, GRID_H, type World } from '../sim/world';
import { OUTLINE, paintedShade, specular, wobblyCircle } from './style';
import { drawPlant, drawRock, drawTree, PLANT_SPECIES, ROCK_SPECIES, TREE_SPECIES } from './naturalAssets';

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
  // A second, higher-frequency octave layered under the coarse noise — the
  // difference between a painted wash and a single flat gradient.
  const fineNoise = makeNoise(rng, 26, 17);
  const speckle = new Rng(world.seed ^ 0x51ab3c);
  const pal = PALETTES[world.spec.biome] ?? PALETTES.meadow!;

  // Shared field every brush/scatter layer reads from, so grass strokes,
  // grit, and tufts all lean the same way the ground under them leans —
  // dirt-toned over a dirt patch, grass-toned over lush ground — instead of
  // each layer rolling its own independent, uncorrelated color.
  const dirtLeanAt = (px: number, py: number): number => {
    const u = px / world.widthPx;
    const v = py / world.heightPx;
    return Math.min(1, Math.max(0, (dirtNoise(u, v) - 0.52) / 0.32));
  };

  const g = new Graphics();
  // Base wash at half-cell resolution with continuous (not per-cell-snapped)
  // sampling — colors drift smoothly across a tile instead of stepping at
  // cell boundaries, the biggest single fix for the layers reading as blended.
  const SUB = CELL / 2;
  for (let py = SUB / 2; py < world.heightPx; py += SUB) {
    for (let px = SUB / 2; px < world.widthPx; px += SUB) {
      const cx = Math.floor(px / CELL);
      const cy = Math.floor(py / CELL);
      const u = px / world.widthPx;
      const v = py / world.heightPx;
      const h = world.heightAt(px, py);
      const d = 14;
      const sun = Math.min(
        1.22,
        Math.max(0.78, 1 + (world.heightAt(px - d, py - d) - world.heightAt(px + d, py + d)) * 2.2),
      );
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
        // fine octave: subtle mottling within a coarse patch, not a hard step
        color = lerpColor(color, pal.light, (fineNoise(u, v) - 0.5) * 0.16);
        const dirtT = dirtLeanAt(px, py);
        if (dirtT > 0) color = lerpColor(color, pal.dirt, dirtT * 0.85);
        color = lerpColor(color, speckle.next() > 0.5 ? pal.light : pal.dark, 0.1);
        // Elevation wash: high ground warms toward a sunlit tan, so a hill
        // reads at a glance instead of needing the hachure ink up close.
        const hillWarm = Math.min(1, Math.max(0, (h - 0.56) / 0.32));
        if (hillWarm > 0) color = lerpColor(color, 0xcdbb78, hillWarm * 0.22);
        color = shade(color, bright * 0.86);
      }
      g.rect(px - SUB / 2, py - SUB / 2, SUB, SUB).fill(color);
    }
  }

  // Grass-blade brush pass: short angled strokes over open ground, tinted
  // toward dirt or grass by the SAME field the base wash reads — a stroke
  // drawn over a dirt patch reads as a dry/worn blade, not a random fleck.
  const brush = new Rng(world.seed ^ 0x3d17c2);
  const brushCount = Math.round(GRID_W * GRID_H * 4.4);
  for (let i = 0; i < brushCount; i++) {
    const px = brush.range(0, world.widthPx);
    const py = brush.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    const dirtT = dirtLeanAt(px, py);
    const a = brush.range(-1.95, -1.15);
    const len = brush.range(2.2, 6) * (1 - dirtT * 0.4); // shorter, sparser blades on drier ground
    const light = brush.next() > 0.5;
    const tone = lerpColor(light ? pal.light : pal.dark, pal.dirt, dirtT * 0.7);
    g.moveTo(px, py)
      .lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len)
      .stroke({ width: 0.6, color: tone, alpha: brush.range(0.1, 0.22) * (1 - dirtT * 0.3) });
  }

  // Fine grit pass: scattered pebbles, dirt flecks, and worn patches at a
  // sub-cell scale — denser and darker where the ground already leans dirt,
  // sparse over lush grass, so it reads as the SAME ground drying out rather
  // than an unrelated overlay.
  const grit = new Rng(world.seed ^ 0x6a12f3);
  const gritCount = Math.round(GRID_W * GRID_H * 3.2);
  for (let i = 0; i < gritCount; i++) {
    const px = grit.range(0, world.widthPx);
    const py = grit.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (world.water[cy * GRID_W + cx] || world.cliff[cy * GRID_W + cx]) continue;
    const dirtT = dirtLeanAt(px, py);
    if (dirtT < 0.15 && grit.next() > 0.55) continue; // thin out over lush ground
    const dark = grit.next() > 0.35 - dirtT * 0.25;
    const size = grit.range(0.5, 1.8) * (1 + dirtT * 0.4);
    g.circle(px, py, size).fill({
      color: dark ? pal.dirt : pal.light,
      alpha: grit.range(0.08, dark ? 0.24 : 0.14) * (0.7 + dirtT * 0.5),
    });
  }

  // Soft mottle blotches: broad, very-low-alpha irregular patches of grass
  // tone drifting warmer/cooler — the last bit of "painted" depth that pure
  // noise-and-scatter can't give, closer to a glaze than a texture.
  const mottle = new Rng(world.seed ^ 0x2f9a63);
  const mottleCount = Math.round(GRID_W * GRID_H * 0.06);
  for (let i = 0; i < mottleCount; i++) {
    const px = mottle.range(0, world.widthPx);
    const py = mottle.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    const warm = mottle.next() > 0.5;
    const r = mottle.range(30, 70);
    const n = 8;
    const pts: number[] = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      pts.push(px + Math.cos(a) * r * mottle.range(0.6, 1.15), py + Math.sin(a) * r * mottle.range(0.6, 1.15));
    }
    g.poly(pts).fill({ color: warm ? pal.dirt : pal.light, alpha: 0.04 });
  }

  // Grass tufts: small multi-blade clumps, density set by biome and thinned
  // over dirt-leaning ground (tufts don't grow on a worn patch) — the same
  // field driving every other layer, so patches read as ONE dry spot instead
  // of grass, dirt-tinted grit, and tufts all disagreeing about it.
  // Most of these are plain grass tufts; a fraction pull from the wider plant
  // library (ferns, wildflowers, mushrooms, bramble...) filtered to species
  // that belong in this biome, so the ground floor has real variety instead
  // of one clump shape repeated everywhere.
  const tuftRng = new Rng(world.seed ^ 0x1e5f0a);
  const tuftCount = Math.round(GRID_W * GRID_H * pal.grassDensity * 1.25);
  const biomePlants = PLANT_SPECIES.filter((p) => p.shape !== 'grass' && p.biomes.includes(world.spec.biome));
  for (let i = 0; i < tuftCount; i++) {
    const px = tuftRng.range(0, world.widthPx);
    const py = tuftRng.range(0, world.heightPx);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    if (!isOpenGround(world, cx, cy)) continue;
    const dirtT = dirtLeanAt(px, py);
    if (tuftRng.next() < dirtT * 0.8) continue;
    if (biomePlants.length > 0 && tuftRng.next() < 0.16) {
      const species = biomePlants[tuftRng.int(0, biomePlants.length - 1)]!;
      drawPlant(g, tuftRng, px, py, tuftRng.range(0.8, 1.2), species);
      continue;
    }
    const tone = lerpColor(pal.light, pal.dirt, dirtT * 0.5);
    drawGrassTuft(g, tuftRng, px, py, tuftRng.range(0.7, 1.3) * (1 - dirtT * 0.3), tone, pal.dark);
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
  // Tinted toward the biome's own dirt tone, not a fixed foreign ink color —
  // reads as part of the same painted ground instead of a decal on top of it.
  const HACH_INK = lerpColor(0x362c1c, pal.dirt, 0.32);
  const HACH_LIGHT = lerpColor(0xcfc088, pal.light, 0.3);
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

  // Cliff faces: a strong dark contour right at the actual drop-off (the
  // border between a cliff cell and open/water ground) so it reads instantly
  // as an impassable wall, plus layered strata texture within the face.
  const cliffRng = new Rng(world.seed ^ 0x9c41e7);
  const CLIFF_EDGE = 0x1c1712;
  const CLIFF_STRATA_LIGHT = lerpColor(CLIFF_COLOR, 0xffffff, 0.18);
  const CLIFF_STRATA_DARK = shade(CLIFF_DARK, 0.75);
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      if (world.cliff[cy * GRID_W + cx] !== 1) continue;
      const x0 = cx * CELL;
      const y0 = cy * CELL;
      const edges: [number, number, number, number, number, number][] = [
        [1, 0, x0 + CELL, y0, x0 + CELL, y0 + CELL],
        [-1, 0, x0, y0, x0, y0 + CELL],
        [0, 1, x0, y0 + CELL, x0 + CELL, y0 + CELL],
        [0, -1, x0, y0, x0 + CELL, y0],
      ];
      for (const [dx, dy, ex0, ey0, ex1, ey1] of edges) {
        const nx = cx + dx;
        const ny = cy + dy;
        const neighborCliff = nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && world.cliff[ny * GRID_W + nx] === 1;
        if (neighborCliff) continue; // interior seam between two cliff cells — no edge needed
        g.moveTo(ex0, ey0).lineTo(ex1, ey1).stroke({ width: 2.2, color: CLIFF_EDGE, alpha: 0.6 });
        g.moveTo(ex0, ey0).lineTo(ex1, ey1).stroke({ width: 0.8, color: CLIFF_STRATA_LIGHT, alpha: 0.3 });
      }
      // rock-face strata: a few roughly parallel bands within the cell
      for (let i = 0; i < 3; i++) {
        const ly = y0 + CELL * (0.22 + i * 0.28) + cliffRng.range(-2.5, 2.5);
        g.moveTo(x0 + 2, ly + cliffRng.range(-2, 2))
          .lineTo(x0 + CELL - 2, ly + cliffRng.range(-2, 2))
          .stroke({ width: 0.8, color: i % 2 === 0 ? CLIFF_STRATA_LIGHT : CLIFF_STRATA_DARK, alpha: 0.28 });
      }
    }
  }

  // Water surface: ripple strokes, a foam highlight along every shore, and
  // the odd sunlit sparkle — flat two-tone fill was the least finished patch
  // of ground compared to everything else.
  const waterRng = new Rng(world.seed ^ 0x5e2a91);
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const wv = world.water[cy * GRID_W + cx];
      if (!wv) continue;
      const x0 = cx * CELL;
      const y0 = cy * CELL;
      // ripples
      if (waterRng.next() < 0.75) {
        const px = x0 + waterRng.range(4, CELL - 4);
        const py = y0 + waterRng.range(4, CELL - 4);
        const len = waterRng.range(6, 13);
        const bow = waterRng.range(-2.5, 2.5);
        g.moveTo(px - len / 2, py)
          .quadraticCurveTo(px, py + bow, px + len / 2, py)
          .stroke({ width: 0.6, color: wv === 2 ? 0x4a7a94 : 0x74acb6, alpha: waterRng.range(0.14, 0.3) });
      }
      // sparse sunlit sparkle on deep water only
      if (wv === 2 && waterRng.next() < 0.06) {
        specular(g, x0 + waterRng.range(6, CELL - 6), y0 + waterRng.range(6, CELL - 6), 0.9, 0.4);
      }
      // shore foam: a light lapping line on any edge touching dry ground
      const dryNeighbor =
        isOpenGround(world, cx - 1, cy) ||
        isOpenGround(world, cx + 1, cy) ||
        isOpenGround(world, cx, cy - 1) ||
        isOpenGround(world, cx, cy + 1);
      if (dryNeighbor) {
        // Explicit per-direction edges (not a formula) — a vertical edge
        // spans the cell's full HEIGHT at a fixed x, a horizontal edge spans
        // the full WIDTH at a fixed y; a generalized formula for this
        // mismatched an axis on the first attempt and collapsed two of the
        // four edges to zero-length lines.
        const shoreEdges: [number, number, number, number, number, number][] = [
          [1, 0, x0 + CELL, y0, x0 + CELL, y0 + CELL],
          [-1, 0, x0, y0, x0, y0 + CELL],
          [0, 1, x0, y0 + CELL, x0 + CELL, y0 + CELL],
          [0, -1, x0, y0, x0 + CELL, y0],
        ];
        for (const [dx, dy, ex0, ey0, ex1, ey1] of shoreEdges) {
          if (!isOpenGround(world, cx + dx, cy + dy)) continue;
          g.moveTo(ex0, ey0).lineTo(ex1, ey1).stroke({ width: 1.4, color: 0xdcecec, alpha: 0.3 });
        }
      }
    }
  }

  const texture = RenderTexture.create({ width: world.widthPx, height: world.heightPx });
  renderer.render({ container: g, target: texture });
  g.destroy();
  return new Sprite(texture);
}

const SHADOW_COL = 0x000000;

// Species mix per biome — weighted by repeating a key, so common trees for
// that biome come up more often without needing a separate weight table.
const TREE_MIX: Record<string, string[]> = {
  meadow: ['oak', 'oak', 'oak', 'elderOak', 'birch', 'aspen', 'willow', 'maple', 'snag'],
  forest: ['oak', 'oak', 'elderOak', 'elderOak', 'pine', 'pine', 'spruce', 'birch', 'willow', 'snag'],
  steppe: ['scrubPine', 'scrubPine', 'aspen', 'snag', 'oak'],
};
const ROCK_MIX: Record<string, string[]> = {
  meadow: ['granite', 'granite', 'mossyBoulder', 'crackedGranite', 'rubble', 'limestone'],
  forest: ['mossyBoulder', 'mossyBoulder', 'granite', 'crackedGranite', 'rubble', 'basalt'],
  steppe: ['sandstone', 'sandstone', 'granite', 'slateLedge', 'rubble', 'limestone'],
};

function pick<T>(rng: Rng, keys: string[], table: T[], keyOf: (t: T) => string): T {
  const wantKey = keys[rng.int(0, keys.length - 1)]!;
  return table.find((t) => keyOf(t) === wantKey) ?? table[rng.int(0, table.length - 1)]!;
}

export function buildObstacleLayer(world: World): Container {
  const layer = new Container();
  const shadows = new Graphics();
  const bodies = new Graphics();
  const rng = new Rng(world.seed ^ 0x77aa11);
  const treeMix = TREE_MIX[world.spec.biome] ?? TREE_MIX.meadow!;
  const rockMix = ROCK_MIX[world.spec.biome] ?? ROCK_MIX.meadow!;

  for (const o of world.obstacles) {
    shadows
      .ellipse(o.x + o.radius * 0.25, o.y + o.radius * 0.3, o.radius * 1.05, o.radius * 0.6)
      .fill({ color: SHADOW_COL, alpha: 0.2 });
  }

  for (const o of world.obstacles) {
    if (o.kind === 'tree') {
      drawTree(bodies, rng, o.x, o.y, o.radius, pick(rng, treeMix, TREE_SPECIES, (s) => s.key));
    } else {
      drawRock(bodies, rng, o.x, o.y, o.radius, pick(rng, rockMix, ROCK_SPECIES, (s) => s.key));
    }
  }

  layer.addChild(shadows, bodies);
  return layer;
}
