import { Graphics } from 'pixi.js';
import { Rng } from '../sim/rng';
import {
  crossHatch,
  grime,
  OUTLINE,
  paintedShade,
  smoothBlob,
  stipple,
  wobblyCircle,
  wobblyEllipse,
  wobblyLine,
} from './style';
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

// ---------------------------- FOLIAGE ----------------------------
// A crown is built from many small overlapping leaf clumps rather than a few
// flat lobes with a crescent painted on. A top-down tree in this style reads
// as a MASS of foliage catching light unevenly; a solid disc with a highlight
// arc reads as a green button, which is what these were.

/** The deep shadow tone a species' foliage falls to where no light reaches. */
function canopyShadow(species: TreeSpecies): number {
  return lerpColor(species.dark, 0x080f06, 0.45);
}

/** One clump of leaves: a small irregular blob, sometimes edged for leaf definition. */
function leafClump(g: Graphics, rng: Rng, x: number, y: number, r: number, color: number): void {
  const n = 7;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.68, 1.3);
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  smoothBlob(g, pts, color, lerpColor(color, 0x080f06, 0.55), rng.next() < 0.45 ? 0.5 : 0);
}

export interface Lobe {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** How far inside the union of lobes a point sits: 1 at a lobe's centre, 0 outside them all. */
function insideLobes(lobes: Lobe[], px: number, py: number): number {
  let best = 0;
  for (const l of lobes) {
    const dx = (px - l.x) / l.rx;
    const dy = (py - l.y) / l.ry;
    const d = Math.hypot(dx, dy);
    if (d < 1 && 1 - d > best) best = 1 - d;
  }
  return best;
}

/** March outward from (cx, cy) along an angle and return the last radius still inside the crown. */
function crownEdge(lobes: Lobe[], cx: number, cy: number, angle: number, maxR: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let last = 0;
  for (let t = 0.1; t <= 1.0; t += 0.06) {
    if (insideLobes(lobes, cx + dx * maxR * t, cy + dy * maxR * t) > 0) last = maxR * t;
  }
  return last;
}

/**
 * Fill a crown (one or more overlapping lobes) with clumped foliage: a near
 * black under-mass so every gap between clumps reads as canopy shadow rather
 * than grass showing through, clumps lit by which way they face the sun and
 * how far out from the middle they sit, a rim of brighter clumps along the lit
 * edge, and a couple of holes punched through to the dark interior.
 */
function crownFoliage(
  g: Graphics,
  rng: Rng,
  lobes: Lobe[],
  cx: number,
  cy: number,
  crownR: number,
  species: TreeSpecies,
  hue: number,
): void {
  const under = canopyShadow(species);
  for (const l of lobes) wobblyEllipse(g, rng, l.x, l.y, l.rx, l.ry, under, OUTLINE, 1.2);

  const clumpR = Math.max(2.0, crownR * 0.24);
  // Scaled off radius, not area: a wood can hold a few hundred crowns and an
  // area-proportional count would put tens of thousands of blobs in one
  // Graphics. Big crowns still get roughly triple the clumps of small ones.
  const target = Math.max(6, Math.round(crownR * 1.4));
  let placed = 0;
  for (let tries = 0; tries < target * 7 && placed < target; tries++) {
    const px = cx + rng.range(-crownR, crownR);
    const py = cy + rng.range(-crownR, crownR);
    const ins = insideLobes(lobes, px, py);
    if (ins <= 0.03) continue;
    placed++;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    // Which way this clump faces relative to the sun, weighted by how far out
    // it sits — the middle of a crown is ambient, the edges take a side.
    const facing = dist > 0.5 ? (dx * Math.cos(LIGHT_A) + dy * Math.sin(LIGHT_A)) / dist : 0;
    const out = Math.min(1, dist / crownR);
    // Biased down the ramp: this is shaded woodland foliage, and clumps
    // spread evenly across the full dark-to-light range washed out pale.
    const t = 0.24 + facing * out * 0.34 + (1 - ins) * -0.1 + hue + rng.range(-0.08, 0.08);
    leafClump(
      g,
      rng,
      px,
      py,
      clumpR * rng.range(0.62, 1.3),
      shade(lerpColor(species.dark, species.light, Math.min(1, Math.max(0, t))), 0.88),
    );
  }

  // Sunlit rim: smaller clumps hugging the lit edge, warm rather than bright —
  // a near-white rim is the wrong language for ink-and-wash art.
  const rimN = Math.max(3, Math.round(target * 0.22));
  for (let i = 0; i < rimN; i++) {
    const a = LIGHT_A + rng.range(-1.15, 1.15);
    const edge = crownEdge(lobes, cx, cy, a, crownR * 1.3);
    if (edge <= 0) continue;
    const rr = edge * rng.range(0.7, 0.93);
    leafClump(
      g,
      rng,
      cx + Math.cos(a) * rr,
      cy + Math.sin(a) * rr,
      clumpR * rng.range(0.45, 0.85),
      lerpColor(species.light, 0xbfc878, 0.3),
    );
  }

  // Leaf texture: scratchy strokes and specks across the whole crown, so the
  // clumps read as a rough drawn mass instead of smooth flat shapes.
  const leafInk = lerpColor(species.dark, 0x080f06, 0.35);
  for (let i = 0; i < Math.round(crownR * 1.6); i++) {
    const px = cx + rng.range(-crownR, crownR);
    const py = cy + rng.range(-crownR, crownR);
    if (insideLobes(lobes, px, py) <= 0.05) continue;
    const a = rng.range(0, Math.PI * 2);
    const len = clumpR * rng.range(0.35, 0.9);
    g.moveTo(px, py)
      .lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len)
      .stroke({ width: rng.range(0.3, 0.6), color: leafInk, alpha: rng.range(0.2, 0.5) });
  }
  stipple(
    g,
    rng,
    cx,
    cy,
    crownR * 0.9,
    Math.round(crownR * 1.1),
    [leafInk, species.light, species.dark],
    0.15,
    0.4,
    0.3,
    0.85,
  );
  // Hatching packed into the shaded side of the crown.
  crossHatch(g, rng, cx, cy, crownR * 0.92, DARK_A, Math.round(crownR * 1.1), leafInk, 0.34, 0.5);

  // Holes through the crown to the shadow underneath.
  for (let i = 0; i < rng.int(1, 3); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.15, 0.62) * crownR;
    const hx = cx + Math.cos(a) * d;
    const hy = cy + Math.sin(a) * d;
    if (insideLobes(lobes, hx, hy) <= 0.1) continue;
    g.ellipse(hx, hy, clumpR * rng.range(0.35, 0.75), clumpR * rng.range(0.3, 0.65)).fill({
      color: under,
      alpha: 0.8,
    });
  }
}

/**
 * One radial branch of a conifer: a narrow spike with needle notches down each
 * side. Seen from above a pine is a wheel of these, not the flat serrated
 * star the old code stamped out.
 */
function frond(
  g: Graphics,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  perpX: number,
  perpY: number,
  len: number,
  w: number,
  color: number,
  outline: number,
): void {
  const K = 5;
  const pts: number[] = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const wid = w * (1 - t) * (k % 2 === 0 ? 1 : 0.5);
    pts.push(cx + ax * len * t - perpX * wid, cy + ay * len * t - perpY * wid);
  }
  for (let k = K; k >= 0; k--) {
    const t = k / K;
    const wid = w * (1 - t) * (k % 2 === 0 ? 0.5 : 1);
    pts.push(cx + ax * len * t + perpX * wid, cy + ay * len * t + perpY * wid);
  }
  g.poly(pts).fill(color).stroke({ width: 0.4, color: outline, alpha: 0.45 });
}

/** A conifer crown: two rings of radial fronds over a dark under-mass. */
function coniferCrown(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  species: TreeSpecies,
  hue: number,
  squash: number,
): void {
  const under = canopyShadow(species);
  wobblyEllipse(g, rng, cx, cy, r * 0.9, r * 0.9 * squash, under, OUTLINE, 1.1);
  for (let ring = 0; ring < 2; ring++) {
    const rr = r * (ring === 0 ? 1 : 0.6);
    const n = Math.max(7, Math.round(rr * 0.7));
    const base = rng.range(0, Math.PI * 2) + ring * 0.5;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const ax = Math.cos(a);
      const ay = Math.sin(a) * squash;
      const facing = Math.cos(a) * Math.cos(LIGHT_A) + Math.sin(a) * Math.sin(LIGHT_A);
      const t = 0.2 + facing * 0.3 + ring * 0.12 + hue + rng.range(-0.07, 0.07);
      frond(
        g,
        cx,
        cy,
        ax,
        ay,
        -Math.sin(a),
        Math.cos(a) * squash,
        rr * rng.range(0.8, 1.06),
        rr * 0.16,
        shade(lerpColor(species.dark, species.light, Math.min(1, Math.max(0, t))), 0.88),
        under,
      );
    }
  }
  // Needle scratches running out along the fronds, plus grain — without them
  // each frond is a flat filled wedge.
  for (let i = 0; i < Math.round(r * 2.2); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = r * rng.range(0.18, 0.95);
    const px = cx + Math.cos(a) * d;
    const py = cy + Math.sin(a) * d * squash;
    const len = r * rng.range(0.08, 0.2);
    g.moveTo(px, py)
      .lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len * squash)
      .stroke({ width: rng.range(0.3, 0.55), color: under, alpha: rng.range(0.25, 0.55) });
  }
  stipple(g, rng, cx, cy, r * 0.9, Math.round(r * 1.1), [under, species.light], 0.15, 0.4, 0.3, 0.8);
  crossHatch(g, rng, cx, cy, r * 0.9, DARK_A, Math.round(r * 1.1), under, 0.34, 0.5);
  // The leader at the very top of the tree, pointing straight at the viewer.
  wobblyCircle(g, rng, cx, cy, r * 0.15, shade(lerpColor(species.dark, species.light, 0.45 + hue), 0.9), under, 0.7);
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

/**
 * One limb: a gently bending, tapering run drawn as short round-capped
 * segments, each laid down as a dark under-stroke with a lighter bark core on
 * top — the same outline-plus-fill logic the rest of the art uses, at branch
 * scale. Returns the tip and its heading so a caller can fork from it.
 */
function limbRun(
  g: Graphics,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  len: number,
  w0: number,
  w1: number,
  species: TreeSpecies,
  shadow: boolean,
): [number, number, number] {
  const segs = Math.max(2, Math.round(len / 5));
  const bend = rng.range(-0.55, 0.55) / segs; // one steady curve, not random noise
  let cx = x;
  let cy = y;
  let a = angle;
  for (let i = 0; i < segs; i++) {
    a += bend + rng.range(-0.06, 0.06);
    const step = len / segs;
    const nx = cx + Math.cos(a) * step;
    const ny = cy + Math.sin(a) * step;
    const w = w0 + (w1 - w0) * ((i + 1) / segs);
    if (shadow) {
      g.moveTo(cx, cy).lineTo(nx, ny).stroke({ width: w + 1.4, color: 0x000000, alpha: 0.13, cap: 'round' });
    } else {
      g.moveTo(cx, cy).lineTo(nx, ny).stroke({ width: w + 0.9, color: OUTLINE, alpha: 0.8, cap: 'round' });
      g.moveTo(cx, cy).lineTo(nx, ny).stroke({ width: w, color: species.bark, cap: 'round' });
      // A hairline of lit bark along the top-left of thicker limbs — without
      // it a branch is one flat grey value and reads as bent wire.
      if (w > 1.3) {
        const off = w * 0.26;
        g.moveTo(cx + Math.cos(LIGHT_A) * off, cy + Math.sin(LIGHT_A) * off)
          .lineTo(nx + Math.cos(LIGHT_A) * off, ny + Math.sin(LIGHT_A) * off)
          .stroke({ width: w * 0.3, color: species.light, alpha: 0.5, cap: 'round' });
      }
    }
    cx = nx;
    cy = ny;
  }
  return [cx, cy, a];
}

/** A limb that forks into thinner limbs, recursively, until it runs out of depth. */
function deadLimb(
  g: Graphics,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  len: number,
  width: number,
  depth: number,
  species: TreeSpecies,
  shadow: boolean,
): void {
  const [tx, ty, ta] = limbRun(g, rng, x, y, angle, len, width, width * 0.5, species, shadow);
  if (depth <= 0 || len < 5) {
    // Snapped-off end: a pale splintered nub where the twig broke.
    if (rng.next() < 0.45 && !shadow) {
      g.circle(tx, ty, Math.max(0.5, width * 0.45)).fill({ color: species.light, alpha: 0.65 });
    }
    return;
  }
  const forks = rng.next() < 0.25 ? 1 : 2;
  const spread = rng.range(0.35, 0.8);
  for (let i = 0; i < forks; i++) {
    const sign = forks === 1 ? (rng.next() < 0.5 ? -1 : 1) : i === 0 ? -1 : 1;
    deadLimb(
      g,
      rng,
      tx,
      ty,
      ta + sign * spread * rng.range(0.6, 1.25),
      len * rng.range(0.5, 0.72),
      width * 0.62,
      depth - 1,
      species,
      shadow,
    );
  }
}

/** The full limb structure of one snag, replayable from a seed so the shadow pass matches the tree exactly. */
function snagLimbs(
  g: Graphics,
  seed: number,
  x: number,
  y: number,
  r: number,
  trunkR: number,
  tier: TreeTier,
  species: TreeSpecies,
  shadow: boolean,
): void {
  const rng = new Rng(seed);
  const limbs = tier === 'large' ? rng.int(4, 5) : tier === 'medium' ? rng.int(3, 4) : 3;
  const w0 = tier === 'large' ? 2.7 : tier === 'medium' ? 2.1 : 1.5;
  const base = rng.range(0, Math.PI * 2);
  for (let i = 0; i < limbs; i++) {
    // One limb per angular sector, jittered inside it — keeps two limbs from
    // stacking on top of each other while still looking unplanned. Roughly a
    // third come out stubby: evenly long limbs were what made the old version
    // read as a starfish.
    const a = base + ((i + rng.range(0.1, 0.9)) / limbs) * Math.PI * 2;
    const len = r * (rng.next() < 0.35 ? rng.range(0.34, 0.55) : rng.range(0.7, 1.0));
    const start = trunkR * 0.55;
    deadLimb(g, rng, x + Math.cos(a) * start, y + Math.sin(a) * start, a, len, w0, 2, species, shadow);
  }
}

/**
 * A bare standing snag seen from above. The old version fired 4-6 straight
 * spokes of constant width out of a single point at evenly spaced angles,
 * which read as an asterisk rather than a tree; this gives each limb its own
 * length, a bend, a taper, and a fork tree of its own, casts a shadow shaped
 * like the actual branches instead of a solid ellipse a bare tree would never
 * throw, and caps the middle with a broken stump so the limbs emerge from
 * under something rather than converging on a bare point.
 */
function drawDeadSnag(
  g: Graphics,
  rng: Rng,
  x: number,
  y: number,
  r: number,
  tier: TreeTier,
  species: TreeSpecies,
): void {
  const trunkR = (tier === 'large' ? 0.24 : tier === 'medium' ? 0.16 : 0.11) * 22;
  const limbSeed = rng.int(0, 0x7ffffffe);
  // Shadow first, offset away from the light, replayed from the same seed so
  // it is genuinely this tree's own silhouette.
  const sx = -Math.cos(LIGHT_A) * r * 0.2;
  const sy = -Math.sin(LIGHT_A) * r * 0.2;
  g.ellipse(x + sx, y + sy, trunkR * 1.1, trunkR * 0.8).fill({ color: 0x000000, alpha: 0.15 });
  snagLimbs(g, limbSeed, x + sx, y + sy, r, trunkR, tier, species, true);

  drawRootFlare(g, rng, x, y, tier, species);
  snagLimbs(g, limbSeed, x, y, r, trunkR, tier, species, false);

  // A broken-off stump, not a disc: an irregular bark rim with a paler
  // heartwood core and radial splits, so the middle reads as snapped timber
  // rather than a rivet head holding the branches on.
  const ring = (rad: number, jitter: number): number[] => {
    const pts: number[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = rad * rng.range(1 - jitter, 1 + jitter);
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    return pts;
  };
  smoothBlob(g, ring(trunkR * 0.95, 0.16), species.bark, species.barkDark, 1.1);
  smoothBlob(g, ring(trunkR * 0.62, 0.2), lerpColor(species.bark, species.light, 0.45), species.barkDark, 0.6);
  for (let i = 0; i < rng.int(2, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    g.moveTo(x, y)
      .lineTo(x + Math.cos(a) * trunkR * 0.85, y + Math.sin(a) * trunkR * 0.85)
      .stroke({ width: 0.7, color: species.barkDark, alpha: 0.75 });
  }
  paintedShade(g, x, y, trunkR * 0.7, LIGHT_A, DARK_A, 0xd8d0bc, 0x000000);
  // Ivy/moss creeping up the stump instead of leaves — a dead tree with a
  // green canopy was part of what read wrong before.
  if (rng.next() < 0.5) grime(g, rng, x, y, trunkR * 1.1, rng.int(3, 5), [0x4a5c2a, 0x3a4620]);
}

/** Draw one tree at (x, y) with canopy radius r, sized tier, of the given species. */
export function drawTree(g: Graphics, rng: Rng, x: number, y: number, r: number, species: TreeSpecies): void {
  const tier = treeTier(r);
  const hue = rng.range(-0.08, 0.1);

  if (species.shape === 'dead') {
    drawDeadSnag(g, rng, x, y, r, tier, species);
    return;
  }

  const trunkR = drawRootFlare(g, rng, x, y, tier, species);

  if (species.shape === 'conifer' || species.shape === 'narrowConifer') {
    const narrow = species.shape === 'narrowConifer';
    coniferCrown(g, rng, x, y, narrow ? r * 0.82 : r, species, hue, narrow ? 0.72 : 0.88);
    void trunkR;
    return;
  }

  if (species.shape === 'weeping') {
    // Asymmetric main mass, plus drooping tendrils trailing outward/down.
    const massX = x - r * 0.1;
    const massY = y - r * 0.15;
    const massR = r * 0.72;
    const lobes: Lobe[] = [
      { x: massX, y: massY, rx: massR, ry: massR * 0.95 },
      { x: massX + r * 0.28, y: massY + r * 0.2, rx: massR * 0.55, ry: massR * 0.5 },
    ];
    crownFoliage(g, rng, lobes, massX, massY, massR * 1.15, species, hue);
    const tendrils = rng.int(10, 15);
    for (let i = 0; i < tendrils; i++) {
      const a = (i / tendrils) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const startR = r * 0.55;
      const x0 = x + Math.cos(a) * startR * 0.6;
      const y0 = y + Math.sin(a) * startR * 0.6 - r * 0.1;
      const x1 = x + Math.cos(a) * r * rng.range(0.9, 1.25);
      const y1 = y + Math.sin(a) * r * rng.range(0.5, 0.75) + r * 0.35;
      g.moveTo(x0, y0).quadraticCurveTo(x0, y0 + r * 0.4, x1, y1).stroke({
        width: rng.range(0.7, 1.3),
        color: lerpColor(species.dark, species.light, rng.range(0.3, 0.8)),
        alpha: 0.8,
      });
      // A few leaf flecks strung along the trailing end of each withy.
      for (let k = 0; k < rng.int(1, 3); k++) {
        const t = rng.range(0.55, 1);
        g.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rng.range(0.6, 1.3)).fill({
          color: lerpColor(species.dark, species.light, rng.range(0.4, 0.9)),
          alpha: 0.85,
        });
      }
    }
    void trunkR;
    return;
  }

  // 'round' and 'oval': a crown of overlapping lobes filled with clumped
  // foliage. Oval species are taller and sparser, so the trunk drawn
  // underneath shows through the gaps.
  const oval = species.shape === 'oval';
  const lobeCount = oval ? (tier === 'small' ? 2 : 3) : tier === 'small' ? 2 : tier === 'medium' ? 3 : 5;
  const lobes: Lobe[] = [];
  for (let i = 0; i < lobeCount; i++) {
    const a = (i / lobeCount) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = i === 0 ? 0 : r * rng.range(0.25, 0.42) * (oval ? 1.15 : 1);
    const lr = r * (i === 0 ? rng.range(0.72, 0.92) : rng.range(0.44, 0.64)) * (oval ? 0.9 : 1);
    lobes.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d * (oval ? 1.3 : 1),
      rx: lr,
      ry: lr * (oval ? 1.15 : 1),
    });
  }
  crownFoliage(g, rng, lobes, x, y, r * 1.05, species, hue);

  // Boughs showing through the leaves on a big old crown — the structure a
  // large tree reads by even from directly above.
  if (tier === 'large') {
    for (let i = 0; i < rng.int(3, 5); i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = r * rng.range(0.45, 0.8);
      g.moveTo(x, y)
        .lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
        .stroke({ width: rng.range(0.9, 1.6), color: species.barkDark, alpha: 0.3, cap: 'round' });
    }
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
    // Every so often a vertex bites deep inward — a chipped or weathered
    // notch. A ring of evenly-jittered points alone gives a smooth potato.
    const chip = rng.next() < 0.12 ? rng.range(0.62, 0.75) : 1;
    const rr = r * rng.range(jitter[0], jitter[1]) * chip;
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  return pts;
}

/**
 * The rough stone surface: grain speckle over the whole face, then hatching
 * bunched into the shaded side. Deliberately NOT geometric facets — flat lit
 * planes read as a rendered 3D solid, which is the wrong language for this
 * hand-inked art and made no sense seen from directly above. Roughness and
 * hatch density carry the form instead.
 */
function stoneSurface(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  base: number,
  dark: number,
): void {
  stipple(
    g,
    rng,
    cx,
    cy,
    r * 0.88,
    Math.round(r * 3.2),
    [dark, shade(base, 0.8), shade(base, 1.12), shade(dark, 0.7)],
    0.12,
    0.42,
    0.25,
    0.85,
  );
  crossHatch(g, rng, cx, cy, r * 0.9, DARK_A, Math.round(r * 1.5), shade(dark, 0.65), 0.4, 0.55);
  crossHatch(g, rng, cx, cy, r * 0.9, DARK_A, Math.round(r * 0.8), shade(dark, 0.5), 0.34, 0.45);
  // A sparse, muted counter-hatch on the lit side keeps that side textured too
  // instead of leaving a clean empty patch of flat fill.
  crossHatch(g, rng, cx, cy, r * 0.85, LIGHT_A, Math.round(r * 0.5), shade(base, 1.16), 0.16, 0.4);
}

/** Wandering crack networks — dark, no polished lit lip. */
function rockCracks(g: Graphics, rng: Rng, cx: number, cy: number, r: number, dark: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const sa = rng.range(0, Math.PI * 2);
    let x = cx + Math.cos(sa) * r * rng.range(0, 0.4);
    let y = cy + Math.sin(sa) * r * rng.range(0, 0.4);
    let dir = rng.range(0, Math.PI * 2);
    const segs = rng.int(3, 6);
    for (let s = 0; s < segs; s++) {
      dir += rng.range(-0.65, 0.65);
      const len = r * rng.range(0.13, 0.3);
      const nx = x + Math.cos(dir) * len;
      const ny = y + Math.sin(dir) * len;
      if (Math.hypot(nx - cx, ny - cy) > r * 0.9) break;
      wobblyLine(g, rng, x, y, nx, ny, rng.range(0.55, 1.2), shade(dark, 0.6), 0.8);
      x = nx;
      y = ny;
    }
  }
}

/** A lichen patch: a ragged dark-green blob, stippled at its edges rather than haloed. */
function lichenPatch(g: Graphics, rng: Rng, cx: number, cy: number, r: number, color: number): void {
  const n = 10;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.45, 1.25);
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  smoothBlob(g, pts, color, 0, 0);
  stipple(g, rng, cx, cy, r * 1.25, rng.int(6, 12), [color, shade(color, 0.62), shade(color, 1.25)], 0.3, 0.7, 0.4, 1.2);
}

/** Draw one rock at (x, y) with base radius r, of the given species. */
export function drawRock(g: Graphics, rng: Rng, x: number, y: number, r: number, species: RockSpecies): void {
  // Everything sits a stop darker than the species swatch: these are wet,
  // weathered, shaded stones under a canopy, not lit museum specimens.
  const base = shade(species.base, 0.82);
  const dark = shade(species.dark, 0.85);
  const INK = 0x14100b;
  switch (species.shape) {
    case 'layered': {
      // Stacked sedimentary plates, each with an undercut shadow and bedding
      // seams scratched across its face.
      const plates = rng.int(3, 4);
      for (let i = 0; i < plates; i++) {
        const oy = (i - (plates - 1) / 2) * r * 0.24;
        const w = r * (1.05 - i * 0.09);
        const h = r * 0.4;
        const pts = boulderSilhouette(rng, x, y + oy, w, 12, [0.82, 1.0]).map((v, idx) =>
          idx % 2 === 1 ? y + oy + (v - (y + oy)) * (h / w) : v,
        );
        smoothBlob(g, pts, shade(base, 1 - i * 0.07), INK, 1.2);
        g.moveTo(x - w * 0.85, y + oy + h * 0.55)
          .quadraticCurveTo(x, y + oy + h * 0.95, x + w * 0.85, y + oy + h * 0.5)
          .stroke({ width: r * 0.1, color: INK, alpha: 0.4 });
        for (let k = 0; k < 3; k++) {
          const sy = y + oy + h * rng.range(-0.45, 0.4);
          wobblyLine(g, rng, x - w * 0.78, sy, x + w * 0.78, sy + rng.range(-1.5, 1.5), 0.55, dark, 0.6);
        }
        stipple(g, rng, x, y + oy, w * 0.85, Math.round(w * 2), [dark, shade(base, 1.12), INK], 0.12, 0.4);
        crossHatch(g, rng, x, y + oy, h * 0.95, DARK_A, Math.round(w * 0.9), shade(dark, 0.6), 0.38, 0.5);
        paintedShade(g, x, y + oy, h * 0.85, LIGHT_A, DARK_A, 0xd8d2c4, 0x000000);
      }
      break;
    }
    case 'rubble': {
      // A loose cluster of small stones — no single dominant boulder.
      const n = rng.int(5, 8);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.75);
        const rr = r * rng.range(0.24, 0.48);
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        g.ellipse(px - Math.cos(LIGHT_A) * rr * 0.35, py - Math.sin(LIGHT_A) * rr * 0.35, rr * 0.95, rr * 0.7).fill({
          color: 0x000000,
          alpha: 0.2,
        });
        const pts = boulderSilhouette(rng, px, py, rr, rng.int(8, 10), [0.82, 1.02]);
        smoothBlob(g, pts, base, INK, 1.0);
        stoneSurface(g, rng, px, py, rr, base, dark);
        paintedShade(g, px, py, rr * 0.62, LIGHT_A, DARK_A, 0xd0cabc, 0x000000);
      }
      break;
    }
    case 'pitted': {
      const pts = boulderSilhouette(rng, x, y, r, rng.int(10, 13), [0.84, 1.0]);
      smoothBlob(g, pts, base, INK, 1.4);
      stoneSurface(g, rng, x, y, r, base, dark);
      // Weathered hollows: dark bites out of the surface, ragged rather than
      // round, with no rim highlight — a lit rim read as a bump, not a hole.
      for (let i = 0; i < rng.int(8, 14); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.72);
        const pr = rng.range(0.8, 2.2);
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        const ring: number[] = [];
        for (let k = 0; k < 6; k++) {
          const ka = (k / 6) * Math.PI * 2;
          const kr = pr * rng.range(0.6, 1.3);
          ring.push(px + Math.cos(ka) * kr, py + Math.sin(ka) * kr);
        }
        smoothBlob(g, ring, INK, 0, 0);
      }
      paintedShade(g, x, y, r * 0.62, LIGHT_A, DARK_A, 0xd8d2c4, 0x000000);
      break;
    }
    case 'faceted':
    default: {
      // Both the cracked and the rounded boulders: a rough inked mass whose
      // form comes from hatch density and crack networks, not lit planes.
      const jitter: [number, number] = species.shape === 'faceted' ? [0.84, 1.06] : [0.86, 1.05];
      const pts = boulderSilhouette(rng, x, y, r, rng.int(11, 14), jitter);
      smoothBlob(g, pts, base, INK, 1.4);
      stoneSurface(g, rng, x, y, r, base, dark);
      rockCracks(g, rng, x, y, r, dark, species.shape === 'faceted' ? rng.int(4, 6) : rng.int(2, 4));
      paintedShade(g, x, y, r * 0.58, LIGHT_A, DARK_A, 0xd8d2c4, 0x000000);
    }
  }

  if (species.mossy || rng.next() < 0.5) {
    // Lichen colonises the shaded side, in a few patches of varying size
    // rather than one even sprinkle.
    for (let i = 0; i < rng.int(2, 4); i++) {
      const ma = DARK_A + rng.range(-0.8, 0.8);
      const md = r * rng.range(0.25, 0.62);
      lichenPatch(
        g,
        rng,
        x + Math.cos(ma) * md,
        y + Math.sin(ma) * md,
        r * rng.range(0.14, 0.3),
        shade([MOSS, 0x5c6e34, 0x3a4620][rng.int(0, 2)]!, 0.85),
      );
    }
  }
  if (species.shape !== 'rubble' && r > 14 && rng.next() < 0.7) {
    // Broken-off pieces resting at the base of the parent boulder.
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = r * rng.range(0.85, 1.2);
      const pr = r * rng.range(0.12, 0.28);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      g.ellipse(px - Math.cos(LIGHT_A) * pr * 0.4, py - Math.sin(LIGHT_A) * pr * 0.4, pr, pr * 0.72).fill({
        color: 0x000000,
        alpha: 0.2,
      });
      const pts = boulderSilhouette(rng, px, py, pr, rng.int(8, 10), [0.85, 1.02]);
      smoothBlob(g, pts, base, INK, 1.0);
      stipple(g, rng, px, py, pr * 0.85, Math.round(pr * 2.5), [dark, shade(base, 1.1)], 0.15, 0.45);
      paintedShade(g, px, py, pr * 0.6, LIGHT_A, DARK_A, 0xd0cabc, 0x000000);
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
