import { Graphics } from 'pixi.js';
import { Rng } from '../sim/rng';
import { grime, OUTLINE, paintedShade, smoothBlob, stipple, wobblyCircle, wobblyEllipse, wobblyLine } from './style';
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

// Foliage carries three tones, not two: a near-black outer ring, a mid body,
// and a bright lit core. That dark-rim-to-bright-centre ramp inside a heavy
// black outline is the whole read of the battlemap style being matched — a
// two-tone canopy has nowhere to put the lit crown and goes flat.
export interface TreeSpecies {
  key: string;
  name: string;
  shape: TreeShape;
  dark: number;
  mid: number;
  light: number;
  bark: number;
  barkDark: number;
}

/** The near-black line every piece of foliage is drawn with. */
const CANOPY_INK = 0x0a1408;

export const TREE_SPECIES: TreeSpecies[] = [
  { key: 'oak', name: 'Oak', shape: 'round', dark: 0x11360f, mid: 0x246b1c, light: 0x66b234, bark: 0x4a3520, barkDark: 0x2e2010 },
  { key: 'elderOak', name: 'Elder Oak', shape: 'round', dark: 0x0d2c0e, mid: 0x1d5a19, light: 0x559a2c, bark: 0x3f2c18, barkDark: 0x28190c },
  { key: 'birch', name: 'Birch', shape: 'oval', dark: 0x2c4f16, mid: 0x548720, light: 0x93bb3c, bark: 0xd8d0bc, barkDark: 0x8c8470 },
  { key: 'aspen', name: 'Aspen', shape: 'oval', dark: 0x35571a, mid: 0x638f22, light: 0xa2c545, bark: 0xc2c0a8, barkDark: 0x7a7862 },
  { key: 'pine', name: 'Pine', shape: 'conifer', dark: 0x0c2a18, mid: 0x1a4c28, light: 0x3f8140, bark: 0x4a3520, barkDark: 0x2e2010 },
  { key: 'spruce', name: 'Spruce', shape: 'narrowConifer', dark: 0x0b2a24, mid: 0x1a4c3c, light: 0x36805e, bark: 0x453424, barkDark: 0x2a2014 },
  { key: 'scrubPine', name: 'Scrub Pine', shape: 'conifer', dark: 0x1e3c1a, mid: 0x3c6828, light: 0x6d9c3c, bark: 0x564228, barkDark: 0x362818 },
  { key: 'willow', name: 'Willow', shape: 'weeping', dark: 0x24421a, mid: 0x467428, light: 0x7fae44, bark: 0x4a3d28, barkDark: 0x2e2418 },
  { key: 'snag', name: 'Dead Snag', shape: 'dead', dark: 0x4a453c, mid: 0x5a5448, light: 0x6a6458, bark: 0x504a3e, barkDark: 0x342f26 },
  { key: 'maple', name: 'Autumn Maple', shape: 'round', dark: 0x5c2c0c, mid: 0x9c5a14, light: 0xd08c22, bark: 0x4a3520, barkDark: 0x2e2010 },
];

export type TreeTier = 'small' | 'medium' | 'large';
export function treeTier(r: number): TreeTier {
  return r > 25 ? 'large' : r > 17 ? 'medium' : 'small';
}

// ---------------------------- FOLIAGE ----------------------------
// Built to match the battlemap reference: bold drawn SHAPES inside heavy black
// ink, ramping from a near-black outer rim to a bright lit core. Detail comes
// from legible marks — scalloped leaf layers, round leaf puffs, radial creases
// — not from noise. Earlier passes here reached for stipple and hatching to
// add "texture" and only produced grey mush; at the size a tree occupies on
// screen, one clean scallop reads and fifty specks do not.

/** The deep shadow tone a species' foliage falls to where no light reaches. */
function canopyShadow(species: TreeSpecies): number {
  return lerpColor(species.dark, 0x040a04, 0.5);
}

/**
 * A closed ring of foliage with a scalloped edge — the lobed cabbage-like
 * outline the reference trees are built from. `depth` is how far the scallops
 * bite in as a fraction of the radius.
 */
function scallopRing(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  lobes: number,
  depth: number,
  fill: number,
  inkWidth: number,
): void {
  const n = Math.max(30, lobes * 5);
  const phase = rng.range(0, Math.PI * 2);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bump = 0.5 + 0.5 * Math.cos((a - phase) * lobes);
    const rad = r * (1 - depth + bump * depth) * rng.range(0.975, 1.025);
    pts.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.poly(pts).fill(fill);
  if (inkWidth > 0) g.poly(pts).stroke({ width: inkWidth, color: CANOPY_INK });
}

/**
 * The rosette crown: concentric scalloped layers stepping from a near-black
 * rim to a bright lit centre, cut through by radial creases. This is the
 * signature broadleaf of the reference maps.
 */
function rosetteCrown(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  species: TreeSpecies,
  hue: number,
): void {
  const tones = [canopyShadow(species), species.dark, species.mid, species.light];
  const rings = tones.length;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const rr = r * (1 - t * 0.62);
    // Successive layers drift toward the light, so the bright core sits
    // off-centre the way a real crown's sunlit top does.
    const ox = cx + Math.cos(LIGHT_A) * r * 0.07 * t;
    const oy = cy + Math.sin(LIGHT_A) * r * 0.07 * t;
    const lobes = Math.max(6, Math.round(rr * 0.52));
    const tone = i === 0 ? tones[0]! : lerpColor(tones[i]!, tones[Math.min(rings - 1, i + 1)]!, hue + 0.12);
    scallopRing(g, rng, ox, oy, rr, lobes, 0.2 - t * 0.06, tone, i === 0 ? Math.max(1.6, r * 0.09) : 1.3);
  }
  // Radial creases: the gaps between leaf clusters, cut from the rim inward.
  const creases = Math.max(5, Math.round(r * 0.4));
  for (let i = 0; i < creases; i++) {
    const a = (i / creases) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const r0 = r * rng.range(0.2, 0.42);
    const r1 = r * rng.range(0.85, 1.0);
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      .lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      .stroke({ width: rng.range(0.7, 1.4), color: CANOPY_INK, alpha: 0.55 });
  }
}

/**
 * The puff crown: a cluster of round leaf bundles, outer ones dark and inner
 * ones bright, each inked. The bushier, more broken-up broadleaf of the
 * reference — used where the rosette would look too uniform.
 */
function puffCrown(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  species: TreeSpecies,
  hue: number,
): void {
  const under = canopyShadow(species);
  wobblyEllipse(g, rng, cx, cy, rx * 1.02, ry * 1.02, under, CANOPY_INK, Math.max(1.6, rx * 0.09));
  // Bare branches showing between the bundles.
  for (let i = 0; i < rng.int(4, 7); i++) {
    const a = rng.range(0, Math.PI * 2);
    g.moveTo(cx, cy)
      .lineTo(cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85)
      .stroke({ width: rng.range(0.8, 1.5), color: species.barkDark, alpha: 0.6, cap: 'round' });
  }
  const rings: [number, number, number][] = [
    [0.72, Math.max(6, Math.round(rx * 0.4)), 0.0],
    [0.4, Math.max(4, Math.round(rx * 0.22)), 0.45],
    [0.0, 1, 1.0],
  ];
  for (const [dist, count, litT] of rings) {
    const spin = rng.range(0, Math.PI * 2);
    for (let i = 0; i < count; i++) {
      const a = spin + (i / count) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const px = cx + Math.cos(a) * rx * dist;
      const py = cy + Math.sin(a) * ry * dist;
      // Puffs on the lit side of the crown ride a little further up the ramp.
      const facing = Math.cos(a) * Math.cos(LIGHT_A) + Math.sin(a) * Math.sin(LIGHT_A);
      const t = Math.min(1, Math.max(0, litT + facing * 0.22 * (1 - litT) + hue + rng.range(-0.07, 0.07)));
      const tone = t < 0.5 ? lerpColor(species.dark, species.mid, t * 2) : lerpColor(species.mid, species.light, (t - 0.5) * 2);
      const pr = Math.min(rx, ry) * rng.range(0.26, 0.4);
      wobblyCircle(g, rng, px, py, pr, tone, CANOPY_INK, 1.2);
      // Two or three arcs inside each bundle: the leaf detail the reference
      // draws rather than a flat disc.
      for (let k = 0; k < rng.int(2, 3); k++) {
        const ka = rng.range(0, Math.PI * 2);
        g.arc(px, py, pr * rng.range(0.4, 0.7), ka, ka + rng.range(0.8, 1.8)).stroke({
          width: 0.7,
          color: CANOPY_INK,
          alpha: 0.45,
        });
      }
    }
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
  g.poly(pts).fill(color);
  g.poly(pts).stroke({ width: 0.9, color: outline, alpha: 0.85 });
}

/**
 * A conifer crown: rings of radial fronds inside a heavy inked rim, ramping
 * from a near-black outer edge to a bright lit leader at the middle — the same
 * dark-rim-to-bright-core read as the broadleaves, in a needled shape.
 */
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
  wobblyEllipse(g, rng, cx, cy, r * 0.92, r * 0.92 * squash, under, CANOPY_INK, Math.max(1.6, r * 0.09));
  for (let ring = 0; ring < 2; ring++) {
    const rr = r * (ring === 0 ? 1 : 0.58);
    const n = Math.max(7, Math.round(rr * 0.6));
    const base = rng.range(0, Math.PI * 2) + ring * 0.5;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const facing = Math.cos(a) * Math.cos(LIGHT_A) + Math.sin(a) * Math.sin(LIGHT_A);
      const t = Math.min(1, Math.max(0, 0.2 + facing * 0.26 + ring * 0.34 + hue + rng.range(-0.06, 0.06)));
      const tone =
        t < 0.5 ? lerpColor(species.dark, species.mid, t * 2) : lerpColor(species.mid, species.light, (t - 0.5) * 2);
      frond(
        g,
        cx,
        cy,
        Math.cos(a),
        Math.sin(a) * squash,
        -Math.sin(a),
        Math.cos(a) * squash,
        rr * rng.range(0.8, 1.06),
        rr * 0.16,
        tone,
        CANOPY_INK,
      );
    }
  }
  // The lit leader at the very top of the tree, pointing at the viewer.
  wobblyCircle(g, rng, cx, cy, r * 0.2, lerpColor(species.light, 0xffffff, 0.12 + hue * 0.3), CANOPY_INK, 1.3);
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
    const massR = r * 0.75;
    puffCrown(g, rng, massX, massY, massR, massR * 0.95, species, hue);
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

  // 'oval' species are the bushier, more broken-up crowns; 'round' species get
  // the signature scalloped rosette.
  if (species.shape === 'oval') {
    puffCrown(g, rng, x, y, r * 0.92, r * 1.02, species, hue);
  } else {
    rosetteCrown(g, rng, x, y, r, species, hue);
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

// Cool blue-greys with a wide light-to-dark spread, matching the reference
// battlemaps: stone there is a flat mid tone with a distinctly paler lit plane
// and a much darker shadowed one, all held inside a heavy black line.
export const ROCK_SPECIES: RockSpecies[] = [
  { key: 'granite', name: 'Granite Boulder', shape: 'boulder', base: 0x6f7d88, dark: 0x39434d, mossy: false },
  { key: 'sandstone', name: 'Sandstone Boulder', shape: 'layered', base: 0x8a7a5e, dark: 0x4c4132, mossy: false },
  { key: 'mossyBoulder', name: 'Mossy Boulder', shape: 'boulder', base: 0x66707a, dark: 0x343c44, mossy: true },
  { key: 'crackedGranite', name: 'Cracked Granite', shape: 'faceted', base: 0x74818c, dark: 0x3c4650, mossy: false },
  { key: 'slateLedge', name: 'Slate Ledge', shape: 'layered', base: 0x5e666e, dark: 0x30363c, mossy: false },
  { key: 'limestone', name: 'Limestone Outcrop', shape: 'pitted', base: 0x968f80, dark: 0x554f44, mossy: false },
  { key: 'rubble', name: 'Rubble Cluster', shape: 'rubble', base: 0x6c7681, dark: 0x373f47, mossy: false },
  { key: 'basalt', name: 'Basalt Rock', shape: 'faceted', base: 0x424852, dark: 0x1e2229, mossy: true },
];

/** The near-black line every piece of stone is drawn with. */
const STONE_INK = 0x0d1218;

const MOSS = 0x4a5c2a;

/**
 * An angular stone outline: straight edges and sharp uneven corners. The
 * reference draws rock as chunky faceted slabs, not rounded pebbles, and the
 * hard silhouette is most of what sells it as stone.
 */
function slabOutline(rng: Rng, cx: number, cy: number, r: number, sides: number): number[] {
  const pts: number[] = [];
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const rr = r * rng.range(0.68, 1.06);
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return pts;
}

/**
 * One inked slab: a flat mid-tone body, a paler lit plane set toward the sun
 * and a darker one away from it, straight fracture lines, and a bold black
 * rim re-drawn last so nothing laid inside can nibble the silhouette.
 */
function drawSlab(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  base: number,
  dark: number,
  light: number,
): void {
  const ink = Math.max(1.5, r * 0.13);
  const body = slabOutline(rng, cx, cy, r, rng.int(5, 8));
  g.poly(body).fill(base);

  const dx = Math.cos(LIGHT_A);
  const dy = Math.sin(LIGHT_A);
  // Shadowed plane first, then the lit one over it.
  g.poly(slabOutline(rng, cx - dx * r * 0.22, cy - dy * r * 0.22, r * 0.52, rng.int(4, 6))).fill(dark);
  const litPlane = slabOutline(rng, cx + dx * r * 0.2, cy + dy * r * 0.2, r * 0.55, rng.int(4, 6));
  g.poly(litPlane).fill(light);
  g.poly(litPlane).stroke({ width: ink * 0.5, color: STONE_INK, alpha: 0.85 });

  // Straight fracture lines running clean across the face.
  for (let i = 0; i < rng.int(2, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const off = r * rng.range(-0.45, 0.45);
    const px = cx - Math.sin(a) * off;
    const py = cy + Math.cos(a) * off;
    const len = r * rng.range(0.5, 1.0);
    g.moveTo(px - Math.cos(a) * len * 0.5, py - Math.sin(a) * len * 0.5)
      .lineTo(px + Math.cos(a) * len * 0.5, py + Math.sin(a) * len * 0.5)
      .stroke({ width: rng.range(0.6, 1.2), color: STONE_INK, alpha: 0.6 });
  }
  // A couple of pale chip streaks on the lit plane.
  for (let i = 0; i < rng.int(1, 3); i++) {
    const a = LIGHT_A + rng.range(-0.9, 0.9);
    const d = r * rng.range(0.15, 0.45);
    const len = r * rng.range(0.2, 0.42);
    const sa = rng.range(0, Math.PI);
    g.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d)
      .lineTo(cx + Math.cos(a) * d + Math.cos(sa) * len, cy + Math.sin(a) * d + Math.sin(sa) * len)
      .stroke({ width: rng.range(0.7, 1.4), color: lerpColor(light, 0xffffff, 0.45), alpha: 0.5 });
  }

  g.poly(body).stroke({ width: ink, color: STONE_INK });
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
  const base = species.base;
  const dark = species.dark;
  const light = lerpColor(base, 0xe8f0f6, 0.42);
  switch (species.shape) {
    case 'layered': {
      // Stacked sedimentary plates: flat slabs, each stepped a shade darker
      // going down, with a hard black seam between them.
      const plates = rng.int(3, 4);
      for (let i = plates - 1; i >= 0; i--) {
        const oy = (i - (plates - 1) / 2) * r * 0.3;
        const w = r * (1.0 - i * 0.08);
        const pts = slabOutline(rng, x, y + oy, w, rng.int(6, 8)).map((v, idx) =>
          idx % 2 === 1 ? y + oy + (v - (y + oy)) * 0.48 : v,
        );
        g.poly(pts).fill(shade(base, 1 - i * 0.12));
        g.poly(pts).stroke({ width: Math.max(1.5, r * 0.12), color: STONE_INK });
        for (let k = 0; k < 2; k++) {
          const sy = y + oy + r * rng.range(-0.16, 0.12);
          g.moveTo(x - w * 0.72, sy)
            .lineTo(x + w * 0.72, sy + rng.range(-1.5, 1.5))
            .stroke({ width: rng.range(0.6, 1.1), color: STONE_INK, alpha: 0.55 });
        }
      }
      break;
    }
    case 'rubble': {
      // A cluster of angular chunks — the scree piles of the reference maps.
      const n = rng.int(5, 8);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.72);
        const rr = r * rng.range(0.26, 0.5);
        drawSlab(g, rng, x + Math.cos(a) * d, y + Math.sin(a) * d, rr, base, dark, light);
      }
      break;
    }
    case 'pitted': {
      drawSlab(g, rng, x, y, r, base, dark, light);
      // Weathered hollows bitten out of the face — flat dark shapes, no rim
      // highlight, since a lit rim reads as a bump rather than a hole.
      for (let i = 0; i < rng.int(5, 9); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.6);
        const pr = r * rng.range(0.08, 0.18);
        g.poly(slabOutline(rng, x + Math.cos(a) * d, y + Math.sin(a) * d, pr, 5)).fill({
          color: STONE_INK,
          alpha: 0.55,
        });
      }
      break;
    }
    case 'faceted':
    default: {
      drawSlab(g, rng, x, y, r, base, dark, light);
      // A second chunk leaning against the first, so a boulder reads as broken
      // rock rather than one lonely polygon.
      if (r > 13 && rng.next() < 0.65) {
        const a = rng.range(0, Math.PI * 2);
        drawSlab(g, rng, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * rng.range(0.4, 0.62), base, dark, light);
      }
    }
  }

  if (species.mossy || rng.next() < 0.5) {
    // Lichen colonising the shaded side, in a few patches of varying size.
    for (let i = 0; i < rng.int(2, 4); i++) {
      const ma = DARK_A + rng.range(-0.8, 0.8);
      const md = r * rng.range(0.25, 0.6);
      lichenPatch(
        g,
        rng,
        x + Math.cos(ma) * md,
        y + Math.sin(ma) * md,
        r * rng.range(0.14, 0.28),
        [MOSS, 0x5c6e34, 0x3a4620][rng.int(0, 2)]!,
      );
    }
  }
  if (species.shape !== 'rubble' && r > 14 && rng.next() < 0.7) {
    // Broken-off chips resting at the base of the parent boulder.
    for (let i = 0; i < rng.int(1, 4); i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = r * rng.range(0.9, 1.25);
      drawSlab(g, rng, x + Math.cos(a) * d, y + Math.sin(a) * d, r * rng.range(0.14, 0.28), base, dark, light);
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
