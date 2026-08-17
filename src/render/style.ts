import type { Graphics } from 'pixi.js';
import { Rng } from '../sim/rng';

// The hand-drawn look: warm dark-brown outlines instead of black, muted warm
// fills, and every shape drawn with a slightly wobbly edge — code imitating an
// unsteady inking hand (Norland-ish).

export const OUTLINE = 0x2e241a;
export const STEEL = 0x9aa1a8;
export const STEEL_DARK = 0x6b7178;
export const WOOD = 0x7a5c38;
export const WOOD_DARK = 0x57401f;
export const SKIN = 0xc9a37e;
export const LEATHER = 0x8a6a42;
export const HORSE_BROWN = 0x6f4b2d;
export const BLOOD = 0x6e1210;
export const BLOOD_DARK = 0x4a0e0c;

export interface TeamPalette {
  cloth: number;
  clothDark: number;
  trim: number;
}

export const TEAMS: TeamPalette[] = [
  { cloth: 0x49699a, clothDark: 0x324b72, trim: 0xd8cfae }, // player — muted blue
  { cloth: 0xa04a3a, clothDark: 0x743226, trim: 0xd8cfae }, // enemy — muted red
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
  const n = Math.max(9, Math.round((rx + ry) * 0.9));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + rng.range(-0.08, 0.08);
    pts.push(cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j);
  }
  g.poly(pts).fill(fill);
  if (outlineWidth > 0) g.poly(pts).stroke({ width: outlineWidth, color: outline });
}

/** A hand-wobbled line (for shafts, blades, ridges). */
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
  const segs = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 7));
  g.moveTo(x0, y0);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const jx = i === segs ? 0 : rng.range(-0.7, 0.7);
    const jy = i === segs ? 0 : rng.range(-0.7, 0.7);
    g.lineTo(x0 + (x1 - x0) * t + jx, y0 + (y1 - y0) * t + jy);
  }
  g.stroke({ width, color });
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
