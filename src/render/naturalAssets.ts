import { Graphics } from 'pixi.js';
import { Rng } from '../sim/rng';
import { grime, OUTLINE, paintedShade, smoothBlob, specular, wobblyCircle, wobblyLine } from './style';
import type { Biome } from '../sim/world';

// A procedural asset LIBRARY: named species with genuinely different
// construction logic (not just palette swaps), each further varied by size,
// hue drift, and per-instance wobble/noise. The combinatorics (10 tree
// species x 3 sizes x continuous hue x per-instance shape noise, etc.) put
// the realized variety well past "100+ distinct trees/rocks/plants" while
// staying fully procedural and cheap — no image assets to source or license.

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

const LIGHT_A = -2.35;
const DARK_A = 0.79;

// ============================== TREES ==============================

export type TreeShape = 'round' | 'oval' | 'conifer' | 'narrowConifer' | 'weeping' | 'dead';

export interface TreeSpecies {
  key: string;
  name: string;
  shape: TreeShape;
  dark: number;
  light: number;
  bark: number;
  barkDark: number;
}

export const TREE_SPECIES: TreeSpecies[] = [
  { key: 'oak', name: 'Oak', shape: 'round', dark: 0x223e1a, light: 0x4c7238, bark: 0x4a3520, barkDark: 0x2e2010 },
  { key: 'elderOak', name: 'Elder Oak', shape: 'round', dark: 0x1c3416, light: 0x426334, bark: 0x3f2c18, barkDark: 0x28190c },
  { key: 'birch', name: 'Birch', shape: 'oval', dark: 0x3d5c2a, light: 0x7a9a52, bark: 0xd8d0bc, barkDark: 0x8c8470 },
  { key: 'aspen', name: 'Aspen', shape: 'oval', dark: 0x4a6a2e, light: 0x8caa4e, bark: 0xc2c0a8, barkDark: 0x7a7862 },
  { key: 'pine', name: 'Pine', shape: 'conifer', dark: 0x1c3524, light: 0x2f5236, bark: 0x4a3520, barkDark: 0x2e2010 },
  { key: 'spruce', name: 'Spruce', shape: 'narrowConifer', dark: 0x1a3630, light: 0x2c5248, bark: 0x453424, barkDark: 0x2a2014 },
  { key: 'scrubPine', name: 'Scrub Pine', shape: 'conifer', dark: 0x304a28, light: 0x4a6a3a, bark: 0x564228, barkDark: 0x362818 },
  { key: 'willow', name: 'Willow', shape: 'weeping', dark: 0x35502a, light: 0x5c8048, bark: 0x4a3d28, barkDark: 0x2e2418 },
  { key: 'snag', name: 'Dead Snag', shape: 'dead', dark: 0x4a453c, light: 0x6a6458, bark: 0x504a3e, barkDark: 0x342f26 },
  { key: 'maple', name: 'Autumn Maple', shape: 'round', dark: 0x7a3418, light: 0xb8681e, bark: 0x4a3520, barkDark: 0x2e2010 },
];

export type TreeTier = 'small' | 'medium' | 'large';
export function treeTier(r: number): TreeTier {
  return r > 25 ? 'large' : r > 17 ? 'medium' : 'small';
}

function conifer(g: Graphics, rng: Rng, cx: number, cy: number, r: number, color: number, tiers: number, squash: number): void {
  for (let t = 0; t < tiers; t++) {
    const tr = r * (1 - t * (0.9 / tiers) * 0.6);
    const ty = cy - t * r * 0.22;
    const spikes = 10;
    const pts: number[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = tr * (i % 2 === 0 ? 1 : 0.7) * (1 + rng.range(-0.06, 0.06));
      pts.push(cx + Math.cos(a) * rr, ty + Math.sin(a) * rr * squash);
    }
    g.poly(pts).fill(shade(color, 1 - t * 0.08)).stroke({ width: 0.8, color: OUTLINE, alpha: 0.7 });
  }
}

function drawRootFlare(g: Graphics, rng: Rng, x: number, y: number, tier: TreeTier, species: TreeSpecies): number {
  const trunkR = tier === 'large' ? 0.24 : tier === 'medium' ? 0.16 : 0.11;
  wobblyCircle(g, rng, x, y, trunkR * 22, species.bark, species.barkDark, 0.8);
  // Visible branching roots at the base — every tree gets a couple of short
  // exposed root tendrils, large/old trees get a full radiating flare.
  const flares = tier === 'large' ? rng.int(4, 6) : tier === 'medium' ? rng.int(2, 4) : rng.int(1, 2);
  const flareLen = tier === 'large' ? 40 : tier === 'medium' ? 28 : 18;
  for (let i = 0; i < flares; i++) {
    const a = rng.range(0, Math.PI * 2);
    wobblyLine(g, rng, x, y, x + Math.cos(a) * trunkR * flareLen, y + Math.sin(a) * trunkR * flareLen, 1.0, species.barkDark);
  }
  return trunkR * 22;
}

/** Draw one tree at (x, y) with canopy radius r, sized tier, of the given species. */
export function drawTree(g: Graphics, rng: Rng, x: number, y: number, r: number, species: TreeSpecies): void {
  const tier = treeTier(r);
  const hue = rng.range(-0.08, 0.1);
  const trunkR = drawRootFlare(g, rng, x, y, tier, species);

  if (species.shape === 'dead') {
    // Bare branching structure — no canopy, just forking limbs with a
    // scattering of sparse leaf tufts near the tips.
    const limbs = rng.int(4, 6);
    for (let i = 0; i < limbs; i++) {
      const a0 = (i / limbs) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const len0 = r * rng.range(0.7, 1.1);
      const x1 = x + Math.cos(a0) * len0;
      const y1 = y + Math.sin(a0) * len0;
      wobblyLine(g, rng, x, y, x1, y1, 1.4, species.barkDark);
      const a1 = a0 + rng.range(-0.7, 0.7);
      const x2 = x1 + Math.cos(a1) * len0 * 0.5;
      const y2 = y1 + Math.sin(a1) * len0 * 0.5;
      wobblyLine(g, rng, x1, y1, x2, y2, 0.9, species.barkDark);
      if (rng.next() < 0.4) {
        wobblyCircle(g, rng, x2, y2, r * 0.14, lerpColor(species.dark, species.light, 0.5), OUTLINE, 0.5);
      }
    }
    return;
  }

  if (species.shape === 'conifer' || species.shape === 'narrowConifer') {
    const narrow = species.shape === 'narrowConifer';
    const color = lerpColor(species.dark, species.light, 0.5 + hue);
    const coniferR = narrow ? r * 0.8 : r;
    conifer(g, rng, x, y, coniferR, color, narrow ? 4 : 3, narrow ? 0.7 : 0.85);
    // Radius kept well inside the star's concave floor (spike points dip to
    // 70% of coniferR) so the shading never pokes out past the needles into
    // open air — that gap is exactly what read as a pale "aura" before.
    paintedShade(g, x, y - r * 0.1, coniferR * 0.62, LIGHT_A, DARK_A, 0xcfe0b0, 0x0a0f06);
    return;
  }

  if (species.shape === 'weeping') {
    // Asymmetric main mass, plus drooping tendrils trailing outward/down.
    const base = lerpColor(species.dark, species.light, 0.5 + hue);
    const massX = x - r * 0.1;
    const massY = y - r * 0.15;
    const massR = r * 0.75;
    wobblyCircle(g, rng, massX, massY, massR, base, OUTLINE, 0.9);
    const tendrils = rng.int(7, 10);
    for (let i = 0; i < tendrils; i++) {
      const a = (i / tendrils) * Math.PI * 2;
      const startR = r * 0.55;
      const x0 = x + Math.cos(a) * startR * 0.6;
      const y0 = y + Math.sin(a) * startR * 0.6 - r * 0.1;
      const x1 = x + Math.cos(a) * r * rng.range(0.9, 1.2);
      const y1 = y + Math.sin(a) * r * rng.range(0.5, 0.75) + r * 0.35;
      g.moveTo(x0, y0).quadraticCurveTo(x0, y0 + r * 0.4, x1, y1).stroke({
        width: 0.9,
        color: lerpColor(species.dark, species.light, rng.range(0.3, 0.7)),
        alpha: 0.75,
      });
    }
    // Shaded on the actual round mass only (tendrils are thin strokes, not a
    // filled area a circular shade could safely wrap).
    paintedShade(g, massX, massY, massR * 0.75, LIGHT_A, DARK_A, 0xcfe0b0, 0x0a0f06);
    return;
  }

  // 'round' and 'oval': multi-lobe canopy, oval species sparser/taller with
  // more visible gaps (thin trunk peeking between lobes) and a lighter wash.
  // Shading is applied PER LOBE (each already knows its own true center and
  // radius) rather than one big wrap over the whole cluster — a multi-blob
  // silhouette has no single circle that safely bounds it, and wrapping one
  // anyway was exactly what leaked a pale halo into the gaps between lobes.
  const oval = species.shape === 'oval';
  const lobes = oval ? (tier === 'small' ? 2 : 3) : tier === 'small' ? 2 : tier === 'medium' ? 3 : 5;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : r * rng.range(0.25, 0.42) * (oval ? 1.15 : 1);
    const lr = r * (i === 0 ? rng.range(0.7, 0.9) : rng.range(0.42, 0.62)) * (oval ? 0.9 : 1);
    const lobeHue = hue + rng.range(-0.05, 0.05);
    const lx = x + Math.cos(a) * d;
    const ly = y + Math.sin(a) * d * (oval ? 1.3 : 1);
    wobblyCircle(g, rng, lx, ly, lr, lerpColor(species.dark, species.light, 0.5 + lobeHue), OUTLINE, 0.9);
    paintedShade(g, lx, ly, lr * 0.85, LIGHT_A, DARK_A, 0xd8ecb0, 0x0a0f06);
  }
  if (tier !== 'small' && rng.next() < 0.55) {
    grime(g, rng, x, y, r * 0.85, 3, [0x6a5030, 0x8a7038]);
  }
  void trunkR;
}

// ============================== ROCKS ==============================

export type RockShape = 'boulder' | 'layered' | 'rubble' | 'faceted' | 'pitted';

export interface RockSpecies {
  key: string;
  name: string;
  shape: RockShape;
  base: number;
  dark: number;
  mossy: boolean;
}

export const ROCK_SPECIES: RockSpecies[] = [
  { key: 'granite', name: 'Granite Boulder', shape: 'boulder', base: 0x767066, dark: 0x4c473f, mossy: false },
  { key: 'sandstone', name: 'Sandstone Boulder', shape: 'layered', base: 0x8a7550, dark: 0x5c4c32, mossy: false },
  { key: 'mossyBoulder', name: 'Mossy Boulder', shape: 'boulder', base: 0x6e685c, dark: 0x46423a, mossy: true },
  { key: 'crackedGranite', name: 'Cracked Granite', shape: 'faceted', base: 0x716b62, dark: 0x48443c, mossy: false },
  { key: 'slateLedge', name: 'Slate Ledge', shape: 'layered', base: 0x5c5a58, dark: 0x383634, mossy: false },
  { key: 'limestone', name: 'Limestone Outcrop', shape: 'pitted', base: 0x9c9484, dark: 0x6c6656, mossy: false },
  { key: 'rubble', name: 'Rubble Cluster', shape: 'rubble', base: 0x726a5c, dark: 0x48423a, mossy: false },
  { key: 'basalt', name: 'Basalt Rock', shape: 'faceted', base: 0x3a3834, dark: 0x201f1c, mossy: true },
];

const MOSS = 0x4a5c2a;

function boulderSilhouette(rng: Rng, x: number, y: number, r: number, sides: number, jitter: [number, number]): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const rr = r * rng.range(jitter[0], jitter[1]);
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  return pts;
}

/** Draw one rock at (x, y) with base radius r, of the given species. */
export function drawRock(g: Graphics, rng: Rng, x: number, y: number, r: number, species: RockSpecies): void {
  switch (species.shape) {
    case 'layered': {
      // 2-3 flattened, slightly offset plates — sedimentary/slab strata.
      const plates = rng.int(2, 3);
      for (let i = 0; i < plates; i++) {
        const oy = (i - (plates - 1) / 2) * r * 0.28;
        const w = r * (1.05 - i * 0.12);
        const h = r * 0.42;
        const pts = boulderSilhouette(rng, x, y + oy, w, 10, [0.82, 1.0]).map((v, idx) =>
          idx % 2 === 1 ? y + oy + (v - (y + oy)) * (h / w) : v,
        );
        smoothBlob(g, pts, shade(species.base, 1 - i * 0.08), species.dark, 1);
        wobblyLine(g, rng, x - w * 0.8, y + oy - h * 0.15, x + w * 0.8, y + oy - h * 0.1, 0.5, species.dark);
        // Shading radius bounded by the plate's SHORT axis (height, not
        // width) — plates are far shorter than they are wide, and a circular
        // wrap sized off the width overshot badly, floating a pale halo
        // above/below the actual slab.
        paintedShade(g, x, y + oy, h * 0.85, LIGHT_A, DARK_A, 0xf0ece0, 0x000000);
      }
      break;
    }
    case 'rubble': {
      // A loose cluster of small rocks — no single dominant boulder.
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.7);
        const rr = r * rng.range(0.28, 0.5);
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        const pts = boulderSilhouette(rng, px, py, rr, rng.int(8, 10), [0.82, 1.02]);
        smoothBlob(g, pts, species.base, species.dark, 0.7);
        // Kept safely inside this piece's own jittered silhouette (min 0.82rr).
        paintedShade(g, px, py, rr * 0.62, LIGHT_A, DARK_A, 0xe8e4d8, 0x000000);
      }
      break;
    }
    case 'faceted': {
      const pts = boulderSilhouette(rng, x, y, r, rng.int(9, 12), [0.84, 1.06]);
      smoothBlob(g, pts, species.base, species.dark, 1.2);
      // Kept inside the silhouette's minimum jitter (0.84r) so the shading
      // never pokes past the actual jagged edge — that gap was the "aura."
      paintedShade(g, x, y, r * 0.62, LIGHT_A, DARK_A, 0xf0ece0, 0x000000);
      const cracks = rng.int(3, 5);
      for (let i = 0; i < cracks; i++) {
        const a0 = rng.range(0, Math.PI * 2);
        const a1 = a0 + rng.range(1.2, 2.6);
        g.moveTo(x + Math.cos(a0) * r * 0.7, y + Math.sin(a0) * r * 0.7)
          .lineTo(x + Math.cos(a1) * r * 0.7, y + Math.sin(a1) * r * 0.7)
          .stroke({ width: 0.6, color: species.dark, alpha: 0.6 });
      }
      break;
    }
    case 'pitted': {
      const pts = boulderSilhouette(rng, x, y, r, rng.int(9, 12), [0.84, 1.0]);
      smoothBlob(g, pts, species.base, species.dark, 1.1);
      paintedShade(g, x, y, r * 0.62, LIGHT_A, DARK_A, 0xf0ece0, 0x000000);
      for (let i = 0; i < rng.int(5, 9); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.65);
        g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(0.6, 1.6)).fill({
          color: species.dark,
          alpha: 0.4,
        });
      }
      break;
    }
    default: {
      // boulder — a smooth, rounded river-stone mass.
      const pts = boulderSilhouette(rng, x, y, r, rng.int(10, 13), [0.86, 1.05]);
      smoothBlob(g, pts, species.base, species.dark, 1.2);
      paintedShade(g, x, y, r * 0.55, LIGHT_A, DARK_A, 0xf0ece0, 0x000000);
      const cracks = rng.int(2, 3);
      for (let i = 0; i < cracks; i++) {
        const a0 = rng.range(0, Math.PI * 2);
        const a1 = a0 + rng.range(1.4, 2.6);
        const r0 = r * rng.range(0.3, 0.8);
        const r1 = r * rng.range(0.3, 0.8);
        g.moveTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0)
          .lineTo(x + Math.cos(a1) * r1, y + Math.sin(a1) * r1)
          .stroke({ width: 0.6, color: species.dark, alpha: 0.55 });
      }
    }
  }

  if (species.mossy || rng.next() < 0.4) {
    const ma = DARK_A + rng.range(-0.4, 0.4);
    grime(g, rng, x + Math.cos(ma) * r * 0.4, y + Math.sin(ma) * r * 0.4, r * 0.55, rng.int(4, 7), [
      MOSS,
      0x5c6e34,
      0x3a4620,
    ]);
  }
  if (rng.next() < 0.3) {
    specular(g, x + Math.cos(LIGHT_A) * r * 0.3, y + Math.sin(LIGHT_A) * r * 0.3, r * 0.12, 0.4);
  }
  if (species.shape !== 'rubble' && r > 16 && rng.next() < 0.55) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = r * rng.range(0.8, 1.15);
      const pr = r * rng.range(0.15, 0.3);
      const pts = boulderSilhouette(rng, x + Math.cos(a) * d, y + Math.sin(a) * d, pr, rng.int(8, 10), [0.85, 1.02]);
      smoothBlob(g, pts, species.base, species.dark, 0.7);
    }
  }
}

// ============================== PLANTS ==============================

export type PlantShape =
  | 'grass'
  | 'fern'
  | 'wildflower'
  | 'bramble'
  | 'log'
  | 'mushroom'
  | 'tallGrass'
  | 'heather';

export interface PlantSpecies {
  key: string;
  shape: PlantShape;
  primary: number;
  secondary: number;
  biomes: Biome[];
}

export const PLANT_SPECIES: PlantSpecies[] = [
  { key: 'grassTuft', shape: 'grass', primary: 0x5d8f43, secondary: 0x3f6b2f, biomes: ['meadow', 'steppe', 'forest'] },
  { key: 'fern', shape: 'fern', primary: 0x3a5c2c, secondary: 0x264018, biomes: ['forest', 'meadow'] },
  { key: 'wildflowerRed', shape: 'wildflower', primary: 0xa8384a, secondary: 0x3f6b2f, biomes: ['meadow'] },
  { key: 'wildflowerYellow', shape: 'wildflower', primary: 0xd8c24a, secondary: 0x5d8f43, biomes: ['meadow', 'steppe'] },
  { key: 'heather', shape: 'heather', primary: 0x8a6ab0, secondary: 0x5d8f43, biomes: ['meadow', 'steppe'] },
  { key: 'bramble', shape: 'bramble', primary: 0x3a4620, secondary: 0x1c2410, biomes: ['forest', 'meadow'] },
  { key: 'mossLog', shape: 'log', primary: 0x4a3520, secondary: 0x4a5c2a, biomes: ['forest'] },
  { key: 'mushroom', shape: 'mushroom', primary: 0x9c5030, secondary: 0xe8dcc0, biomes: ['forest'] },
  { key: 'tallGrass', shape: 'tallGrass', primary: 0x8a7f42, secondary: 0x6c6234, biomes: ['steppe'] },
];

export function drawPlant(g: Graphics, rng: Rng, x: number, y: number, scale: number, species: PlantSpecies): void {
  switch (species.shape) {
    case 'fern': {
      const fronds = rng.int(3, 5);
      for (let i = 0; i < fronds; i++) {
        const a = -Math.PI / 2 + rng.range(-1.0, 1.0);
        const len = scale * rng.range(7, 11);
        const midX = x + Math.cos(a) * len * 0.5;
        const midY = y + Math.sin(a) * len * 0.5;
        const tipX = x + Math.cos(a) * len;
        const tipY = y + Math.sin(a) * len;
        g.moveTo(x, y).quadraticCurveTo(midX, midY, tipX, tipY).stroke({ width: 0.7, color: species.secondary });
        // small pinnate leaflets along the frond
        for (let j = 1; j < 4; j++) {
          const t = j / 4;
          const fx = x + (tipX - x) * t;
          const fy = y + (tipY - y) * t;
          const pa = a + Math.PI / 2;
          g.moveTo(fx, fy)
            .lineTo(fx + Math.cos(pa) * 2.2, fy + Math.sin(pa) * 2.2)
            .stroke({ width: 0.4, color: species.primary, alpha: 0.85 });
          g.moveTo(fx, fy)
            .lineTo(fx - Math.cos(pa) * 2.2, fy - Math.sin(pa) * 2.2)
            .stroke({ width: 0.4, color: species.primary, alpha: 0.85 });
        }
      }
      break;
    }
    case 'wildflower': {
      const stems = rng.int(3, 6);
      for (let i = 0; i < stems; i++) {
        const sx = x + rng.range(-5, 5);
        const sy = y + rng.range(-5, 5);
        const h = rng.range(3, 6);
        g.moveTo(sx, sy).lineTo(sx, sy - h).stroke({ width: 0.4, color: species.secondary });
        g.circle(sx, sy - h, 0.9).fill(species.primary);
      }
      break;
    }
    case 'heather': {
      for (let i = 0; i < rng.int(6, 10); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0, 5);
        g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, rng.range(0.5, 1.1)).fill({
          color: species.primary,
          alpha: 0.75,
        });
      }
      g.ellipse(x, y + 1, 5, 2.4).fill({ color: species.secondary, alpha: 0.3 });
      break;
    }
    case 'bramble': {
      const strands = rng.int(4, 7);
      for (let i = 0; i < strands; i++) {
        const a = rng.range(0, Math.PI * 2);
        const len = rng.range(4, 8);
        const x1 = x + Math.cos(a) * len;
        const y1 = y + Math.sin(a) * len * 0.55;
        wobblyLine(g, rng, x, y, x1, y1, 0.6, i % 2 === 0 ? species.primary : species.secondary);
        if (rng.next() < 0.5) g.circle((x + x1) / 2, (y + y1) / 2, 0.35).fill(0x2a1a14); // thorn
      }
      break;
    }
    case 'log': {
      const len = rng.range(16, 26);
      const a = rng.range(0, Math.PI);
      const dx = Math.cos(a) * len;
      const dy = Math.sin(a) * len * 0.4;
      g.moveTo(x - dx / 2, y - dy / 2)
        .lineTo(x + dx / 2, y + dy / 2)
        .stroke({ width: 4.5, color: species.primary });
      g.moveTo(x - dx / 2, y - dy / 2 - 1)
        .lineTo(x + dx / 2, y + dy / 2 - 1)
        .stroke({ width: 1, color: shade(species.primary, 1.3) });
      grime(g, rng, x, y, len * 0.4, 4, [species.secondary, 0x3a4620]);
      break;
    }
    case 'mushroom': {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const mx = x + rng.range(-4, 4);
        const my = y + rng.range(-4, 4);
        const s = rng.range(0.6, 1.3);
        g.moveTo(mx, my).lineTo(mx, my - 2 * s).stroke({ width: 0.6, color: species.secondary });
        g.ellipse(mx, my - 2.3 * s, 1.6 * s, 0.9 * s).fill(species.primary).stroke({ width: 0.3, color: OUTLINE });
      }
      break;
    }
    case 'tallGrass': {
      const blades = rng.int(4, 6);
      for (let i = 0; i < blades; i++) {
        const a = -Math.PI / 2 + rng.range(-0.5, 0.5);
        const len = scale * rng.range(8, 13);
        const swayX = Math.cos(a) * len * 0.3 + rng.range(-2, 2);
        g.moveTo(x, y)
          .quadraticCurveTo(x + swayX, y - len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len)
          .stroke({ width: 0.5, color: i % 2 === 0 ? species.primary : species.secondary, alpha: 0.85 });
      }
      break;
    }
    default: {
      // grass
      const blades = rng.int(3, 5);
      for (let i = 0; i < blades; i++) {
        const a = rng.range(-1.3, 1.3) - Math.PI / 2;
        const len = scale * rng.range(3, 6);
        const bendX = Math.cos(a) * len * 0.5 + rng.range(-1, 1);
        const bendY = Math.sin(a) * len * 0.5;
        const tipX = Math.cos(a) * len;
        const tipY = Math.sin(a) * len;
        g.moveTo(x, y)
          .quadraticCurveTo(x + bendX, y + bendY, x + tipX, y + tipY)
          .stroke({ width: scale * 0.55, color: i % 2 === 0 ? species.secondary : species.primary, alpha: 0.85 });
      }
    }
  }
}
