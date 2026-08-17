import type { Graphics } from 'pixi.js';
import { Rng } from '../sim/rng';

// The hand-drawn look: warm dark-brown outlines instead of black, muted warm
// fills, and every shape drawn with a slightly wobbly edge — code imitating an
// unsteady inking hand (Norland-ish).

export const OUTLINE = 0x1c150e;
export const STEEL = 0x8a929c;
export const STEEL_DARK = 0x555b62;
export const WOOD = 0x6b4f2f;
export const WOOD_DARK = 0x47331a;
export const SKIN = 0xc09468;
export const LEATHER = 0x7c5c31;
export const HORSE_BROWN = 0x5a3d24;
export const BLOOD = 0x680f0d;
export const BLOOD_DARK = 0x400c0a;

export interface TeamPalette {
  cloth: number;
  clothDark: number;
  trim: number;
}

export const TEAMS: TeamPalette[] = [
  { cloth: 0x33518c, clothDark: 0x213562, trim: 0xcfc4a4 }, // player — rich saturated blue
  { cloth: 0x8f3128, clothDark: 0x611f19, trim: 0xcfc4a4 }, // enemy — deep saturated maroon
];

export function teamOf(team: number): TeamPalette {
  return TEAMS[team] ?? TEAMS[0]!;
}

/** A circle drawn by a slightly unsteady hand. */
export function wobblyCircle(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  fill: number,
  outline: number = OUTLINE,
  outlineWidth = 1.1,
): void {
  wobblyEllipse(g, rng, cx, cy, r, r, fill, outline, outlineWidth);
}

/** An ellipse (axis-aligned) with wobbled edges. */
export function wobblyEllipse(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: number,
  outline: number = OUTLINE,
  outlineWidth = 1.1,
): void {
  const n = Math.max(11, Math.round((rx + ry) * 1.1));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + rng.range(-0.13, 0.13);
    pts.push(cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j);
  }
  g.poly(pts).fill(fill);
  if (outlineWidth > 0) {
    // Stroke in arcs with slight width jitter instead of one uniform pass —
    // a scratchier, hand-inked rim.
    for (let i = 0; i < n; i++) {
      const j2 = i === n - 1 ? 0 : i + 1;
      g.moveTo(pts[i * 2]!, pts[i * 2 + 1]!)
        .lineTo(pts[j2 * 2]!, pts[j2 * 2 + 1]!)
        .stroke({ width: outlineWidth * rng.range(0.75, 1.2), color: outline });
    }
  }
}

/**
 * A hand-wobbled line (for shafts, blades, ridges), drawn as separate
 * scratchy segments with per-segment width jitter — a rougher, more inked
 * feel than one smooth uniform stroke.
 */
export function wobblyLine(
  g: Graphics,
  rng: Rng,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: number,
): void {
  const segs = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6));
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const jx = i === segs ? 0 : rng.range(-1.1, 1.1);
    const jy = i === segs ? 0 : rng.range(-1.1, 1.1);
    pts.push([x0 + (x1 - x0) * t + jx, y0 + (y1 - y0) * t + jy]);
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    g.moveTo(ax, ay)
      .lineTo(bx, by)
      .stroke({ width: width * rng.range(0.8, 1.15), color });
  }
}

/**
 * Weathering: scattered dirt/wear blotches over a shape — grime, scuffs,
 * mud spatter. Mostly dark/rust tones at low alpha so it reads as texture,
 * not damage.
 */
export function grime(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  count: number,
  colors: number[] = [0x2a1f14, 0x4a3520, 0x1c150e],
): void {
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const size = rng.range(r * 0.06, r * 0.22);
    const color = colors[Math.floor(rng.next() * colors.length)]!;
    splat(g, rng, x, y, size, color, rng.range(0.08, 0.24));
  }
}

/**
 * A crescent band hugging the inside of a circle's rim — form shading.
 * angleCenter: where the band's middle sits; spread: half-arc; width: band depth.
 */
export function crescent(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  angleCenter: number,
  spread: number,
  width: number,
  color: number,
  alpha: number,
): void {
  const n = 9;
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = angleCenter - spread + (i / n) * spread * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  for (let i = n; i >= 0; i--) {
    const a = angleCenter - spread + (i / n) * spread * 2;
    const rr = r - width * Math.sin(((i / n) * Math.PI));
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.poly(pts).fill({ color, alpha });
}

/**
 * Short parallel-ish strokes along a direction — wood grain, cloth weave,
 * leather grain. angle: direction the grain runs; spread: how far the
 * strokes fan out perpendicular to it, centered on (cx, cy).
 */
export function grainLines(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  length: number,
  angle: number,
  spread: number,
  count: number,
  color: number,
  alpha: number,
  width = 0.35,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
    const jitter = rng.range(-spread * 0.08, spread * 0.08);
    const x0 = cx + px * (t + jitter);
    const y0 = cy + py * (t + jitter);
    const len = length * rng.range(0.65, 1.15);
    const off = rng.range(-length * 0.1, length * 0.1);
    g.moveTo(x0 + dx * off, y0 + dy * off)
      .lineTo(x0 + dx * (off + len), y0 + dy * (off + len))
      .stroke({ width, color, alpha });
  }
}

/** A drooping fringe of small rings along an arc — mail aventail under a helmet rim. */
export function fringeDots(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  angleStart: number,
  angleEnd: number,
  count: number,
  color: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = angleStart + ((angleEnd - angleStart) * i) / Math.max(1, count - 1);
    g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.28).fill(color);
  }
}

/**
 * Painted-style form shading: several soft falloff layers instead of one
 * hard-edged crescent, so light wraps a surface gradually — the smooth
 * painted look of hand-rendered game portraits rather than flat cel shading.
 */
export function paintedShade(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  lightAngle: number,
  darkAngle: number,
  highlight: number,
  shadow: number,
): void {
  crescent(g, cx, cy, r, lightAngle, 1.25, r * 0.36, highlight, 0.08);
  crescent(g, cx, cy, r, lightAngle, 0.85, r * 0.2, highlight, 0.2);
  crescent(g, cx, cy, r, darkAngle, 1.25, r * 0.34, shadow, 0.09);
  crescent(g, cx, cy, r, darkAngle, 0.85, r * 0.18, shadow, 0.17);
}

/** A glossy specular fleck — a soft outer glow plus a bright hard core. Metal, gems, wet eyes. */
export function specular(g: Graphics, cx: number, cy: number, r: number, alpha = 0.7): void {
  g.circle(cx, cy, r * 2.0).fill({ color: 0xffffff, alpha: alpha * 0.28 });
  g.circle(cx, cy, r).fill({ color: 0xfffdf6, alpha });
}

/** Rivets around a helmet rim or shield edge. */
export function rivets(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  count: number,
  color: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.4;
    g.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.32).fill(color);
  }
}

/** An irregular splat — blood pools and stains. */
export function splat(
  g: Graphics,
  rng: Rng,
  cx: number,
  cy: number,
  r: number,
  color: number,
  alpha = 1,
): void {
  const n = 9;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = rng.range(0.5, 1.35);
    pts.push(cx + Math.cos(a) * r * j, cy + Math.sin(a) * r * j);
  }
  g.poly(pts).fill({ color, alpha });
}
