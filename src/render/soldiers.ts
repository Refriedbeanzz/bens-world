import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Battle, DeathEvent } from '../sim/battle';
import { Rng } from '../sim/rng';
import { UNIT_TYPES, type UnitKey, type UnitType } from '../sim/unittype';
import type { GoreLayer } from './gore';
import {
  crescent,
  fringeDots,
  grainLines,
  grime,
  LEATHER,
  OUTLINE,
  paintedShade,
  rivets,
  SKIN,
  specular,
  STEEL,
  STEEL_DARK,
  WOOD,
  WOOD_DARK,
  teamOf,
  wobblyCircle,
  wobblyEllipse,
  wobblyLine,
  type TeamPalette,
} from './style';

const GAMBESON = 0xb08a52; // padded linen undercoat, peeking at the collar

// Visual variety: every soldier deterministically gets one of VARIANT_COUNT
// looks (helmet style, livery pattern, horse coat) so a formation doesn't
// read as stamped clones. Picked from the soldier's id — stable across
// frames and recoverable later for his corpse without storing extra state.
export const VARIANT_COUNT = 4;
export function hashVariant(id: number): number {
  let t = Math.imul(id, 2654435761) >>> 0;
  t ^= t >>> 15;
  t = Math.imul(t, 2246822519) >>> 0;
  // Force unsigned before mod — XOR reinterprets as signed int32 and a
  // negative operand here would give a negative (invalid) array index.
  return ((t ^ (t >>> 13)) >>> 0) % VARIANT_COUNT;
}

const HORSE_COATS = [0x5a3d24, 0x2a221c, 0x6e3624, 0x7c766a]; // bay, black, chestnut, grey

const HIGHLIGHT = 0xfff3d8;
const SHADOW = 0x160f09;
// Form shading: light from the up-left of the sprite's own frame.
const LIGHT_A = -2.35; // highlight angle
const DARK_A = 0.79; // shadow angle

// Every soldier is a 3-part rig: an armless BODY plus LEFT and RIGHT hands that
// hold the weapons. Hands animate procedurally — swings, thrusts, bow draws —
// driven off sim state (cooldown/reload resets), so 2000 soldiers stay cheap.

export interface Part {
  tex: Texture;
  ax: number;
  ay: number;
}

export interface PartSet {
  body: Part;
  /** A genuine prone silhouette for corpses — not the standing body reused. */
  corpse: Part;
  handL: Part;
  handR: Part;
  shadow: Part;
  mounted: boolean;
}

type AnimKind = 'swing' | 'thrust' | 'lance' | 'loose';

interface RigSpec {
  /** local hand offsets (facing +x; +y is the soldier's right) as [x, y] */
  hl: [number, number];
  hr: [number, number];
  anim: AnimKind;
}

// Hands sit at the body's RIM (shoulder line), never on top of the torso.
function rigSpec(type: UnitType): RigSpec {
  const r = type.radius;
  switch (type.key) {
    case 'pikeman':
      // Rear hand grips the butt (hr, at the shaft's local origin); forward
      // hand (hl) sits further along the SAME shaft, ~16 units up from hr —
      // matches where the shaft actually passes in HandR's own texture, so
      // the two hands read as gripping one continuous pole, not two props.
      return { hl: [r * 2.05, r * 0.72], hr: [-r * 0.2, r * 0.72], anim: 'thrust' };
    case 'archer':
      return { hl: [r * 1.0, -r * 0.35], hr: [r * 0.15, r * 0.5], anim: 'loose' };
    case 'crossbowman':
      return { hl: [r * 0.55, -r * 0.4], hr: [r * 0.9, r * 0.15], anim: 'loose' };
    case 'knight':
      return { hl: [r * 0.6, -r * 0.7], hr: [r * 0.1, r * 0.8], anim: 'lance' };
    case 'cavalry':
      // A held spear thrusts, it doesn't swing like a sword.
      return { hl: [r * 0.6, -r * 0.7], hr: [r * 0.1, r * 0.8], anim: 'thrust' };
    default:
      return { hl: [r * 0.2, -r * 1.0], hr: [r * 0.1, r * 1.05], anim: 'swing' };
  }
}

function bake(renderer: Renderer, seed: number, draw: (g: Graphics, rng: Rng) => void): Part {
  const g = new Graphics();
  draw(g, new Rng(seed));
  const b = g.getLocalBounds();
  const tex = renderer.generateTexture({ target: g, resolution: 8 });
  g.destroy();
  return {
    tex,
    ax: b.width > 0 ? -b.x / b.width : 0.5,
    ay: b.height > 0 ? -b.y / b.height : 0.5,
  };
}

// --- Bodies (armless), drawn facing +x ---

// A livery pattern on the surcoat (and matching shield emblem), bounded
// well inside the surcoat's radius so it never pokes past the round outline.
function surcoatPattern(g: Graphics, r: number, t: TeamPalette, variant: number): void {
  switch (variant % 4) {
    case 0: {
      // quartered: one heraldic quarter, following the coat's own arc
      const quarter: number[] = [0, 0];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        quarter.push(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      }
      g.poly(quarter).fill({ color: t.clothDark, alpha: 0.65 });
      break;
    }
    case 1: {
      // cross throughout
      g.rect(-r * 0.11, -r * 0.62, r * 0.22, r * 1.24).fill({ color: t.clothDark, alpha: 0.65 });
      g.rect(-r * 0.62, -r * 0.11, r * 1.24, r * 0.22).fill({ color: t.clothDark, alpha: 0.65 });
      break;
    }
    case 2: {
      // bend (diagonal band), inset well inside the radius
      const cos45 = Math.SQRT1_2;
      const hl = r * 0.5;
      const hw = r * 0.14;
      const dx = cos45 * hl;
      const dy = cos45 * hl;
      const px = cos45 * hw;
      const py = -cos45 * hw;
      g.poly([-dx - px, -dy - py, -dx + px, -dy + py, dx + px, dy + py, dx - px, dy - py]).fill({
        color: t.clothDark,
        alpha: 0.65,
      });
      break;
    }
    default:
      // plain livery — no overlay pattern
      break;
  }
}

function drawFootBody(g: Graphics, rng: Rng, type: UnitType, team: number, variant: number): void {
  const t = teamOf(team);
  const r = type.radius;

  // Cloak trailing off the back (the -x side, away from facing), drawn first
  // so it sits behind everything and reads as fabric caught mid-stride.
  g.poly([
    -r * 0.3, -r * 0.62,
    -r * 1.05, -r * 0.32,
    -r * 1.25, 0,
    -r * 1.0, r * 0.36,
    -r * 0.3, r * 0.62,
  ])
    .fill({ color: t.clothDark, alpha: 0.92 })
    .stroke({ width: 0.8, color: OUTLINE });
  grainLines(g, rng, -r * 0.75, 0, r * 0.35, 0, r * 0.5, 4, OUTLINE, 0.14, 0.35);

  // mail hauberk under everything: a painted base coat first (so it reads as
  // a rounded surface, not a flat disc), then the dot stipple on top
  wobblyCircle(g, rng, 0, 0, r * 1.02, STEEL_DARK, OUTLINE, 1.2);
  paintedShade(g, 0, 0, r * 1.0, LIGHT_A, DARK_A, STEEL, SHADOW);
  for (let ring = 0; ring < 3; ring++) {
    const rr = r * (0.97 - ring * 0.06);
    const n = 24 - ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.11 + rng.range(-0.04, 0.04);
      g.circle(Math.cos(a) * rr, Math.sin(a) * rr, 0.24).fill(ring === 1 ? STEEL_DARK : STEEL);
    }
  }
  // shoulder mail bumps where the (separate) arms attach, with rim highlight
  wobblyCircle(g, rng, -r * 0.05, -r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  wobblyCircle(g, rng, -r * 0.05, r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  specular(g, -r * 0.05 + Math.cos(LIGHT_A) * r * 0.12, -r * 0.82 + Math.sin(LIGHT_A) * r * 0.12, r * 0.08, 0.5);
  specular(g, -r * 0.05 + Math.cos(LIGHT_A) * r * 0.12, r * 0.82 + Math.sin(LIGHT_A) * r * 0.12, r * 0.08, 0.5);

  // team surcoat, livery-patterned, with form shading, cloth weave, and folds
  wobblyCircle(g, rng, 0, 0, r * 0.8, t.cloth, t.clothDark, 1);
  surcoatPattern(g, r, t, variant);
  paintedShade(g, 0, 0, r * 0.78, LIGHT_A, DARK_A, HIGHLIGHT, SHADOW);
  grainLines(g, rng, -r * 0.15, -r * 0.3, r * 0.5, 0.5, r * 0.9, 5, t.clothDark, 0.16, 0.3);
  grainLines(g, rng, -r * 0.1, r * 0.35, r * 0.5, -0.5, r * 0.9, 5, t.clothDark, 0.16, 0.3);
  // cloth folds
  g.moveTo(-r * 0.55, -r * 0.35).quadraticCurveTo(-r * 0.2, -r * 0.15, -r * 0.6, r * 0.1).stroke({ width: 0.5, color: t.clothDark });
  g.moveTo(-r * 0.5, r * 0.4).quadraticCurveTo(-r * 0.25, r * 0.3, -r * 0.55, r * 0.05).stroke({ width: 0.45, color: t.clothDark });
  // gambeson (padded undercoat) peeking at the collar
  wobblyCircle(g, rng, r * 0.06, 0, r * 0.22, GAMBESON, WOOD_DARK, 0.55);
  grainLines(g, rng, r * 0.06, 0, r * 0.12, 0.9, r * 0.36, 5, WOOD_DARK, 0.35, 0.3);
  // dirt, road grime, and wear scattered over the mail and surcoat
  grime(g, rng, 0, 0, r * 0.98, 10);
  grime(g, rng, r * 0.15, r * 0.4, r * 0.4, 5, [0x5a4326, 0x3a2c18]);

  // belt across the waist: buckle, a small belt-pouch, and a sheathed dagger
  wobblyLine(g, rng, -r * 0.28, -r * 0.72, -r * 0.28, r * 0.72, 1.1, WOOD_DARK);
  g.circle(-r * 0.28, 0, 0.5).fill(t.trim).stroke({ width: 0.35, color: WOOD_DARK });
  wobblyEllipse(g, rng, -r * 0.5, r * 0.42, r * 0.16, r * 0.13, LEATHER, WOOD_DARK, 0.6); // pouch
  wobblyLine(g, rng, -r * 0.5, -r * 0.5, -r * 0.32, -r * 0.68, 1.3, WOOD_DARK); // dagger sheath
  g.circle(-r * 0.5, -r * 0.5, 0.4).fill(STEEL_DARK); // pommel cap

  if (type.key === 'archer') {
    // quiver slung across the back, fletched arrows poking out with visible vanes
    wobblyEllipse(g, rng, -r * 0.6, r * 0.4, r * 0.45, r * 0.22, LEATHER, WOOD_DARK, 0.9);
    wobblyLine(g, rng, -r * 0.75, r * 0.32, -r * 0.75, r * 0.5, 0.5, WOOD_DARK); // strap seam
    for (let i = 0; i < 3; i++) {
      const qy = r * 0.24 + i * r * 0.13;
      g.circle(-r * 0.98, qy, 0.35).fill(WOOD_DARK);
      g.poly([-r * 0.98, qy, -r * 1.14, qy - 0.55, -r * 1.14, qy + 0.55]).fill(t.trim);
    }
    // mail coif, then one of 4 headwear styles
    wobblyCircle(g, rng, r * 0.18, 0, r * 0.52, STEEL_DARK, OUTLINE, 0.9);
    fringeDots(g, r * 0.18, 0, r * 0.5, Math.PI * 0.35, Math.PI * 1.65, 7, STEEL);
    switch (variant % 4) {
      case 0: // leather cap, stitched centre ridge (hood up)
        wobblyCircle(g, rng, r * 0.2, 0, r * 0.4, LEATHER, WOOD_DARK, 0.9);
        wobblyLine(g, rng, r * 0.2, -r * 0.36, r * 0.2, r * 0.36, 0.7, WOOD_DARK);
        break;
      case 1: // hood down: flatter cap with a small folded-back brim
        wobblyCircle(g, rng, r * 0.2, 0, r * 0.36, LEATHER, WOOD_DARK, 0.9);
        wobblyLine(g, rng, r * 0.02, -r * 0.3, r * 0.02, r * 0.3, 0.9, WOOD_DARK); // folded hem
        break;
      case 2: // coif only, no cap layer — bare mail dome
        specular(g, r * 0.18 + Math.cos(LIGHT_A) * r * 0.16, Math.sin(LIGHT_A) * r * 0.16, r * 0.08, 0.45);
        break;
      default: // pointed hood, peaked at the crown
        wobblyCircle(g, rng, r * 0.2, 0, r * 0.38, LEATHER, WOOD_DARK, 0.9);
        g.poly([r * 0.2, -r * 0.02, r * 0.05, -r * 0.5, r * 0.35, -r * 0.3]).fill(LEATHER).stroke({ width: 0.5, color: WOOD_DARK });
    }
    grainLines(g, rng, r * 0.2, 0, r * 0.16, 1.57, r * 0.7, 4, WOOD_DARK, 0.3, 0.3);
    specular(g, r * 0.2 + Math.cos(LIGHT_A) * r * 0.18, Math.sin(LIGHT_A) * r * 0.18, r * 0.07, 0.55);
  } else if (type.key === 'crossbowman') {
    // kettle helm, one of 4 brim/crown profiles
    const brim = [0.58, 0.66, 0.5, 0.58][variant % 4]!;
    const crown = [0.44, 0.46, 0.4, 0.44][variant % 4]!;
    wobblyCircle(g, rng, r * 0.18, 0, r * brim, STEEL_DARK, OUTLINE, 1);
    rivets(g, r * 0.18, 0, r * brim * 0.92, variant % 4 === 1 ? 12 : 9, STEEL_DARK);
    wobblyCircle(g, rng, r * 0.18, 0, r * crown, STEEL, STEEL_DARK, 0.9);
    if (variant % 4 === 2) {
      // tall peaked crown
      g.poly([r * 0.18, -r * 0.06, r * 0.06, -r * 0.44, r * 0.3, -r * 0.44]).fill(STEEL).stroke({ width: 0.5, color: STEEL_DARK });
    } else {
      wobblyCircle(g, rng, r * 0.18, 0, r * 0.24, STEEL, STEEL_DARK, 0.7);
    }
    if (variant % 4 === 3) grime(g, rng, r * 0.05, r * 0.3, r * 0.2, 3, [STEEL_DARK]); // battle-dented
    specular(g, r * 0.18 + Math.cos(LIGHT_A) * r * 0.16, Math.sin(LIGHT_A) * r * 0.16, r * 0.08, 0.65);
    // a second belt pouch for bolt spares
    wobblyEllipse(g, rng, -r * 0.15, -r * 0.58, r * 0.14, r * 0.11, LEATHER, WOOD_DARK, 0.5);
  } else {
    // mail coif with a drooping aventail fringe, then one of 4 helm styles
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.54, STEEL_DARK, OUTLINE, 0.9);
    fringeDots(g, r * 0.16, 0, r * 0.51, Math.PI * 0.3, Math.PI * 1.7, 8, STEEL);
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.42, STEEL, STEEL_DARK, 1);
    switch (variant % 4) {
      case 0: // nasal helm: crown ridge + forward nasal bar
        rivets(g, r * 0.16, 0, r * 0.36, 6, STEEL_DARK);
        wobblyLine(g, rng, -r * 0.2, 0, r * 0.52, 0, 0.8, STEEL_DARK);
        wobblyLine(g, rng, r * 0.55, 0, r * 0.85, 0, 1.1, STEEL);
        break;
      case 1: // smooth domed helm with a small crown knob, no nasal bar
        rivets(g, r * 0.16, 0, r * 0.36, 6, STEEL_DARK);
        g.circle(r * 0.16, 0, r * 0.09).fill(STEEL_DARK);
        break;
      case 2: {
        // banded (spangenhelm) helm: crossed segment bands
        wobblyLine(g, rng, -r * 0.18, 0, r * 0.5, 0, 0.7, STEEL_DARK);
        wobblyLine(g, rng, r * 0.16, -r * 0.36, r * 0.16, r * 0.36, 0.7, STEEL_DARK);
        break;
      }
      default: // brimmed helm: a small rim ring at the base, no nasal bar
        rivets(g, r * 0.16, 0, r * 0.42, 8, STEEL_DARK);
        wobblyCircle(g, rng, r * 0.16, 0, r * 0.46, STEEL_DARK, OUTLINE, 0.6);
        wobblyCircle(g, rng, r * 0.16, 0, r * 0.42, STEEL, STEEL_DARK, 0.9);
    }
    specular(g, r * 0.16 + Math.cos(LIGHT_A) * r * 0.2, Math.sin(LIGHT_A) * r * 0.2, r * 0.09, 0.65);
  }
}

// Half-silhouette of a horse seen from above (facing +x), in units of r.
// Broad haunches, narrow loin, shoulders, long tapering neck, narrow head.
const HORSE_HALF: [number, number][] = [
  [-1.82, 0.3],
  [-1.72, 0.58],
  [-1.35, 0.76],
  [-0.95, 0.78],
  [-0.45, 0.64],
  [0.1, 0.6],
  [0.55, 0.66],
  [0.95, 0.52],
  [1.35, 0.34],
  [1.7, 0.26],
  [2.0, 0.24],
  [2.25, 0.17],
  [2.42, 0.09],
];

function horseOutline(r: number, rng: Rng): number[] {
  const pts: number[] = [-1.86 * r, 0];
  for (const [x, y] of HORSE_HALF) {
    const j = 1 + rng.range(-0.03, 0.03);
    pts.push(x * r, y * r * j);
  }
  pts.push(2.48 * r, 0);
  for (let i = HORSE_HALF.length - 1; i >= 0; i--) {
    const [x, y] = HORSE_HALF[i]!;
    const j = 1 + rng.range(-0.03, 0.03);
    pts.push(x * r, -y * r * j);
  }
  return pts;
}

const HORSE_MANES = [0x4a3520, 0x14110d, 0x502820, 0x5c574c]; // matches HORSE_COATS

function drawHorseBody(g: Graphics, rng: Rng, type: UnitType, team: number, variant: number): void {
  const t = teamOf(team);
  const r = type.radius;
  const heavy = type.key === 'knight';
  const coat = heavy ? t.cloth : HORSE_COATS[variant % 4]!;
  const maneShade = HORSE_MANES[variant % 4]!;

  // tail: a full flowing shape (not a stray line) with inner strands
  const tailColor = heavy ? t.clothDark : maneShade;
  g.poly([
    -r * 1.8, -r * 0.16,
    -r * 2.5, -r * 0.32,
    -r * 2.7, 0,
    -r * 2.5, r * 0.32,
    -r * 1.8, r * 0.16,
  ]).fill(tailColor).stroke({ width: 0.8, color: OUTLINE });
  wobblyLine(g, rng, -r * 2.0, -r * 0.08, -r * 2.55, -r * 0.14, 0.5, heavy ? t.cloth : coat);
  wobblyLine(g, rng, -r * 2.0, r * 0.1, -r * 2.55, r * 0.16, 0.5, heavy ? t.cloth : coat);

  // one continuous body silhouette
  g.poly(horseOutline(r, rng)).fill(coat).stroke({ width: 1.25, color: OUTLINE });

  // ears: two small triangles just behind the head, angled outward
  g.poly([r * 1.86, -r * 0.2, r * 1.7, -r * 0.42, r * 1.98, -r * 0.28]).fill(coat).stroke({ width: 0.6, color: OUTLINE });
  g.poly([r * 1.86, r * 0.2, r * 1.7, r * 0.42, r * 1.98, r * 0.28]).fill(coat).stroke({ width: 0.6, color: OUTLINE });

  // muscle shading: shadow along the right flank, light along the left, plus
  // a short coat-grain texture so the hide doesn't read as flat color
  paintedShade(g, -r * 0.3, 0, r * 1.3, LIGHT_A, DARK_A, HIGHLIGHT, SHADOW);
  grainLines(g, rng, -r * 0.75, -r * 0.05, r * 0.3, 0.35, r * 0.9, 6, OUTLINE, 0.1, 0.3);
  grainLines(g, rng, r * 0.15, 0, r * 0.3, 0.15, r * 0.8, 5, OUTLINE, 0.08, 0.3);
  // haunch and shoulder muscle lines
  g.moveTo(-r * 0.5, -r * 0.5).quadraticCurveTo(-r * 0.3, 0, -r * 0.5, r * 0.5).stroke({ width: 0.5, color: OUTLINE });
  g.moveTo(r * 0.85, -r * 0.4).quadraticCurveTo(r * 0.95, 0, r * 0.85, r * 0.4).stroke({ width: 0.45, color: OUTLINE });
  // mud spatter on the legs' end of the barrel and flank grime
  grime(g, rng, -r * 0.3, r * 0.5, r * 0.5, 6, [0x4a3a20, 0x2e2212]);
  grime(g, rng, r * 0.5, -r * 0.4, r * 0.5, 5, [0x4a3a20, 0x2e2212]);

  // head: a real jaw/muzzle wedge (not a blob) tapering to the nose, then
  // chanfron plate for knights or a blaze stripe for light cavalry
  g.poly([
    r * 1.8, -r * 0.24,
    r * 2.05, -r * 0.22,
    r * 2.42, -r * 0.1,
    r * 2.52, 0,
    r * 2.42, r * 0.1,
    r * 2.05, r * 0.22,
    r * 1.8, r * 0.24,
  ])
    .fill(heavy ? STEEL : coat)
    .stroke({ width: 0.9, color: OUTLINE });
  if (heavy) {
    wobblyLine(g, rng, r * 1.95, 0, r * 2.45, 0, 0.6, STEEL_DARK); // chanfron ridge
    specular(g, r * 2.15 + Math.cos(LIGHT_A) * 0.3, Math.sin(LIGHT_A) * 0.3, 0.3, 0.6);
  } else {
    wobblyLine(g, rng, r * 1.95, 0, r * 2.5, 0, 1.1, 0xe8dcc8); // blaze
  }
  g.circle(r * 1.98, -r * 0.17, 0.36).fill(OUTLINE);
  g.circle(r * 1.98, r * 0.17, 0.36).fill(OUTLINE);
  g.circle(r * 2.45, -r * 0.06, 0.24).fill(SHADOW);
  g.circle(r * 2.45, r * 0.06, 0.24).fill(SHADOW);

  // mane: short strands falling off the neck's left side
  for (let i = 0; i < 6; i++) {
    const x = r * (0.95 + i * 0.15);
    const yTop = -r * (0.42 - i * 0.03);
    wobblyLine(g, rng, x, yTop, x - r * 0.08, yTop - r * 0.14, 0.9, heavy ? t.clothDark : maneShade);
  }

  if (heavy) {
    // caparison: trim border following the body, cloth-weave texture,
    // scalloped hem dots
    const border = horseOutline(r * 0.86, rng);
    g.poly(border).stroke({ width: 0.8, color: t.trim });
    grainLines(g, rng, -r * 0.6, -r * 0.15, r * 0.3, 0.2, r * 1.4, 6, t.clothDark, 0.14, 0.3);
    for (let i = 0; i < 7; i++) {
      const x = -r * 1.5 + i * r * 0.45;
      g.circle(x, -r * 0.66 + Math.abs(x) * 0.04, 0.42).fill(t.trim);
      g.circle(x, r * 0.66 - Math.abs(x) * 0.04, 0.42).fill(t.trim);
    }
  } else {
    // saddle cloth under the rider, trimmed edges, felt texture
    g.poly([-r * 0.62, -r * 0.58, r * 0.42, -r * 0.52, r * 0.42, r * 0.52, -r * 0.62, r * 0.58])
      .fill(t.cloth)
      .stroke({ width: 0.8, color: t.clothDark });
    grainLines(g, rng, -r * 0.1, 0, r * 0.28, 0, r * 0.9, 4, t.clothDark, 0.18, 0.3);
    wobblyLine(g, rng, -r * 0.55, -r * 0.52, -r * 0.55, r * 0.52, 0.7, t.trim);
    wobblyLine(g, rng, r * 0.35, -r * 0.48, r * 0.35, r * 0.48, 0.7, t.trim);
  }

  // tack: girth strap under the belly and a stirrup hint at the flank
  wobblyLine(g, rng, -r * 0.05, -r * 0.78, -r * 0.05, r * 0.78, 0.7, WOOD_DARK);
  g.poly([-r * 0.05, r * 0.55, -r * 0.35, r * 0.72, -r * 0.05, r * 0.72, r * 0.1, r * 0.6]).fill(STEEL_DARK);

  // kite shield slung along the left flank
  g.poly([-r * 0.95, -r * 0.6, -r * 0.35, -r * 0.78, r * 0.2, -r * 0.66, -r * 0.35, -r * 0.52])
    .fill(t.cloth)
    .stroke({ width: 1, color: OUTLINE });
  wobblyLine(g, rng, -r * 0.85, -r * 0.62, r * 0.1, -r * 0.68, 0.5, t.trim);
  g.circle(-r * 0.35, -r * 0.65, 0.6).fill(STEEL).stroke({ width: 0.3, color: STEEL_DARK });
  specular(g, -r * 0.35 + Math.cos(LIGHT_A) * 0.25, -r * 0.65 + Math.sin(LIGHT_A) * 0.25, 0.22, 0.5);

  // reins: bridle line from the head to the rider's forward hand
  wobblyLine(g, rng, r * 1.75, -r * 0.1, r * 0.55, -r * 0.32, 0.4, LEATHER);

  // rider, raised clearly above the horse's back with his own drop shadow so
  // he reads as a separate figure instead of blending into the coat.
  const rx = -r * 0.08;
  g.ellipse(rx + 1.2, r * 0.05, r * 0.34, r * 0.42).fill({ color: 0x000000, alpha: 0.22 }); // seated shadow
  // cloak/cloth torso — wider than the helm so it silhouettes clearly against the coat
  g.poly([
    rx - r * 0.3, -r * 0.4,
    rx + r * 0.28, -r * 0.34,
    rx + r * 0.4, 0,
    rx + r * 0.28, r * 0.34,
    rx - r * 0.3, r * 0.4,
    rx - r * 0.42, 0,
  ])
    .fill(t.cloth)
    .stroke({ width: 1, color: OUTLINE });
  paintedShade(g, rx, 0, r * 0.4, LIGHT_A, DARK_A, HIGHLIGHT, SHADOW);
  // shoulders peeking past the cloak edge
  g.circle(rx - r * 0.1, -r * 0.32, r * 0.13).fill(t.clothDark);
  g.circle(rx - r * 0.1, r * 0.32, r * 0.13).fill(t.clothDark);
  if (heavy) {
    // great helm, sat higher and larger than the body, breath-slit cross,
    // rim rivets, and a highlight — one of 4 crown/crest styles
    wobblyCircle(g, rng, rx, 0, r * 0.4, STEEL, OUTLINE, 1.2);
    rivets(g, rx, 0, r * 0.32, 6, STEEL_DARK);
    wobblyLine(g, rng, rx, -r * 0.29, rx, r * 0.29, 0.7, STEEL_DARK);
    wobblyLine(g, rng, rx - r * 0.27, 0, rx + r * 0.22, 0, 0.7, STEEL_DARK);
    if (variant % 4 === 2) {
      // small triangular crest along the crown, in team trim
      g.poly([rx - r * 0.15, -r * 0.06, rx + r * 0.12, -r * 0.06, rx - r * 0.02, -r * 0.32]).fill(t.trim).stroke({ width: 0.4, color: OUTLINE });
    } else if (variant % 4 === 3) {
      // domed crown highlight band instead of flat-top
      crescent(g, rx, 0, r * 0.36, LIGHT_A, 1.3, r * 0.1, HIGHLIGHT, 0.3);
    }
    specular(g, rx + Math.cos(LIGHT_A) * r * 0.2, Math.sin(LIGHT_A) * r * 0.2, r * 0.09, 0.7);
  } else {
    wobblyCircle(g, rng, rx, 0, r * 0.33, STEEL, STEEL_DARK, 1);
    wobblyLine(g, rng, rx + r * 0.14, 0, rx + r * 0.38, 0, 0.9, STEEL); // nasal
    specular(g, rx + Math.cos(LIGHT_A) * r * 0.14, Math.sin(LIGHT_A) * r * 0.14, r * 0.07, 0.7);
  }
}

// --- Hands (fist + held weapon), drawn facing +x, fist at the origin ---

function drawFist(g: Graphics, rng: Rng, armored: boolean, scale = 1): void {
  const r = 1.55 * scale;
  wobblyCircle(g, rng, 0, 0, r, armored ? STEEL : SKIN, OUTLINE, 0.85);
  if (armored) rivets(g, 0, 0, r * 0.68, 4, STEEL_DARK);
  // knuckle lines so it reads as a gripping fist, not a dot
  wobblyLine(g, rng, -r * 0.37, -r * 0.6, -r * 0.37, r * 0.6, 0.4, armored ? STEEL_DARK : 0xa87f5e);
  wobblyLine(g, rng, -r * 0.05, -r * 0.53, -r * 0.05, r * 0.53, 0.3, armored ? STEEL_DARK : 0x9a734f);
}

// A weapon head/blade tip: RIGID straight edges (no wobble) — wobble suits
// cloth and grain texture, not a forged point that must read as sharp and true.
function drawSpearhead(g: Graphics, rng: Rng, x: number, len: number, w: number): void {
  g.poly([x + len, 0, x, -w, x + len * 0.22, 0, x, w])
    .fill(STEEL)
    .stroke({ width: 0.6, color: STEEL_DARK });
  g.moveTo(x + len * 0.3, 0).lineTo(x + len * 0.85, 0).stroke({ width: 0.35, color: 0xd2d6da }); // midrib glint
  g.poly([x, -w, x + len * 0.5, -w * 0.15, x, 0]).fill({ color: HIGHLIGHT, alpha: 0.22 }); // facet light
  void rng;
}

/**
 * A rigid weapon shaft: a straight (very slightly tapered) pole, never
 * wobbly — a pike or lance must read as a true, stiff rod. Grain texture
 * carries the hand-drawn feel instead of a jittery outline.
 */
function rigidShaft(
  g: Graphics,
  rng: Rng,
  x0: number,
  x1: number,
  w0: number,
  w1: number,
  color: number,
  colorDark: number,
): void {
  g.poly([x0, -w0 / 2, x1, -w1 / 2, x1, w1 / 2, x0, w0 / 2]).fill(color).stroke({ width: 0.6, color: colorDark });
  g.moveTo(x0, -w0 / 2 + 0.3).lineTo(x1, -w1 / 2 + 0.25).stroke({ width: Math.max(0.4, w0 * 0.22), color: colorDark, alpha: 0.8 });
  grainLines(g, rng, (x0 + x1) / 2, 0, (x1 - x0) * 0.06, 0, x1 - x0 - 4, Math.max(4, Math.round((x1 - x0) / 4)), colorDark, 0.4, Math.max(w0, w1) * 0.18);
}

/** A wrapped leather grip on a rigid shaft: base band plus diagonal wrap-lines. */
function wrappedGrip(g: Graphics, rng: Rng, x0: number, x1: number, w: number, color: number): void {
  g.rect(x0, -w / 2, x1 - x0, w).fill(color).stroke({ width: 0.4, color: WOOD_DARK });
  const wraps = Math.max(2, Math.round((x1 - x0) / 1.4));
  for (let i = 0; i < wraps; i++) {
    const x = x0 + ((x1 - x0) * i) / wraps;
    g.moveTo(x, -w / 2).lineTo(x + 0.7, w / 2).stroke({ width: 0.3, color: OUTLINE, alpha: 0.55 });
  }
  void rng;
}

function drawHandR(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'pikeman': {
      // 4m ash pike: one rigid tapered shaft, wrapped grip, langets, leaf head
      rigidShaft(g, rng, -9, 29, 1.7, 1.3, WOOD, WOOD_DARK);
      wrappedGrip(g, rng, -6, 2, 2.0, LEATHER);
      g.moveTo(26, -1.2).lineTo(26, 1.2).stroke({ width: 1, color: STEEL_DARK }); // langet band
      g.moveTo(30.5, -1.2).lineTo(30.5, 1.2).stroke({ width: 1, color: STEEL_DARK });
      drawSpearhead(g, rng, 30, 6.5, 1.9);
      drawFist(g, rng, armored, 0.85);
      break;
    }
    case 'archer': {
      // drawing hand pinching a fletched arrow, nock visible at the string
      wobblyLine(g, rng, -1.5, 0, 8.5, 0, 0.75, WOOD_DARK);
      g.poly([-1.5, 0, -3.6, -1.4, -2.4, 0, -3.6, 1.4]).fill(t.trim); // fletching, 2 vanes visible
      g.poly([-1.5, 0, -3.3, -0.8, -2.4, 0, -3.3, 0.8]).fill({ color: t.clothDark, alpha: 0.7 });
      g.circle(-1.6, 0, 0.35).fill(WOOD_DARK); // nock
      g.poly([8.5, 0, 10.4, -0.65, 10.4, 0.65]).fill(STEEL).stroke({ width: 0.3, color: STEEL_DARK });
      drawFist(g, rng, false);
      break;
    }
    case 'crossbowman': {
      // crossbow held forward: carved tiller with a trigger guard, steel prod,
      // string to the nocked bolt, nut/lever detail at the rear
      g.poly([-5, -1.5, 10, -1.0, 10, 1.0, -5, 1.5]).fill(WOOD).stroke({ width: 0.8, color: WOOD_DARK });
      grainLines(g, rng, 2, 0, 3.2, 0, 2.4, 4, WOOD_DARK, 0.4, 0.3);
      g.poly([-5, 1.2, -6.4, 2.6, -5.4, 3.0, -4.2, 1.6]).fill(WOOD_DARK); // trigger guard
      wobblyCircle(g, rng, -5.6, 2.1, 0.5, STEEL_DARK, OUTLINE, 0.3); // trigger
      g.moveTo(6, -7).quadraticCurveTo(9.6, 0, 6, 7).stroke({ width: 1.8, color: STEEL });
      g.moveTo(6, -7).quadraticCurveTo(8.8, 0, 6, 7).stroke({ width: 0.5, color: STEEL_DARK }); // prod shading
      specular(g, 8.4, -3, 0.35, 0.55); // prod glint
      g.circle(6, -7, 0.75).fill(STEEL_DARK);
      g.circle(6, 7, 0.75).fill(STEEL_DARK);
      g.moveTo(6, -7).lineTo(-0.5, 0).lineTo(6, 7).stroke({ width: 0.6, color: 0xd8cfae }); // string
      g.circle(-0.5, 0, 0.6).fill(WOOD_DARK); // release nut
      wobblyLine(g, rng, 1, 0, 9, 0, 0.7, WOOD_DARK); // bolt in the channel
      g.poly([-1, -1.1, -2.8, -1.7, -1.8, 0]).fill(t.trim); // bolt fletch
      g.poly([9, 0, 10.8, -0.6, 10.8, 0.6]).fill(STEEL);
      drawFist(g, rng, false);
      break;
    }
    case 'knight': {
      // couched lance: two-tone shaft, wrapped grip, steel vamplate, team pennon
      g.poly([-6, -1.2, 37, -0.45, 37, 0.45, -6, 1.2]).fill(WOOD).stroke({ width: 0.7, color: WOOD_DARK });
      grainLines(g, rng, 12, 0, 4, 0, 40, 11, WOOD_DARK, 0.35, 0.28);
      wrappedGrip(g, rng, -3, 4.5, 2.6, LEATHER);
      g.poly([1.5, -2.8, 5, -1.15, 5, 1.15, 1.5, 2.8]).fill(STEEL).stroke({ width: 0.6, color: STEEL_DARK }); // vamplate
      g.poly([2.2, -2.0, 4.3, -0.9, 2.2, 0]).fill({ color: HIGHLIGHT, alpha: 0.3 }); // vamplate glint
      drawSpearhead(g, rng, 37, 4.5, 1.2);
      g.poly([25, -0.7, 33, -0.7, 33, 0.7, 25, 0.7]).fill(t.cloth); // pennon base band
      g.poly([25, -0.7, 33, -0.7, 28.5, -5.4]).fill(t.cloth).stroke({ width: 0.6, color: t.clothDark }); // pennon tail
      wobblyLine(g, rng, 27, -1.6, 27, -4.5, 0.5, t.trim); // pennon fringe accent
      drawFist(g, rng, true);
      break;
    }
    case 'cavalry': {
      // light spear: rigid shaft, leather hand-stop wrap, a smaller head
      rigidShaft(g, rng, -5, 23, 1.4, 1.1, WOOD, WOOD_DARK);
      wrappedGrip(g, rng, 1, 4.5, 1.7, LEATHER);
      drawSpearhead(g, rng, 23, 5, 1.5);
      drawFist(g, rng, armored, 0.85);
      break;
    }
    default: {
      // arming sword: round riveted pommel, wrapped leather grip, crossguard
      // with quillon caps, fullered blade with edge glint
      g.circle(-3.2, 0, 1.15).fill(STEEL_DARK).stroke({ width: 0.5, color: OUTLINE }); // pommel
      g.circle(-3.2, 0, 0.4).fill(STEEL); // pommel rivet
      specular(g, -3.4, -0.35, 0.3, 0.6);
      wrappedGrip(g, rng, -2.3, 1.7, 1.35, LEATHER);
      wobblyLine(g, rng, 2.1, -3.1, 2.1, 3.1, 1.15, STEEL_DARK); // crossguard
      g.circle(2.1, -3.1, 0.4).fill(STEEL); // quillon caps
      g.circle(2.1, 3.1, 0.4).fill(STEEL);
      g.poly([2.6, -1.05, 14.5, -0.6, 16.8, 0, 14.5, 0.6, 2.6, 1.05]) // blade
        .fill(STEEL)
        .stroke({ width: 0.6, color: STEEL_DARK });
      wobblyLine(g, rng, 3, 0, 13.5, 0, 0.45, STEEL_DARK); // fuller
      wobblyLine(g, rng, 3, -0.8, 13, -0.5, 0.35, 0xf0f2f5); // edge glint (upper) — brighter, glossier
      wobblyLine(g, rng, 3, 0.8, 13, 0.5, 0.3, STEEL_DARK); // lower edge shade
      specular(g, 8, -0.55, 0.4, 0.55); // running highlight along the blade
      drawFist(g, rng, armored);
    }
  }
}

function drawHandL(g: Graphics, rng: Rng, type: UnitType, team: number, variant: number): void {
  const t = teamOf(team);
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'archer': {
      // self bow held out: thick tapered stave, recurved horn nocks, string,
      // then the gripping fist, with the leather riser-wrap drawn LAST so it
      // sits visibly on top of the hand instead of being hidden under it.
      g.moveTo(1.5, -9.8);
      g.quadraticCurveTo(7.8, 0, 1.5, 9.8);
      g.stroke({ width: 2.0, color: WOOD });
      g.moveTo(2.3, -8.7);
      g.quadraticCurveTo(7.3, 0, 2.3, 8.7);
      g.stroke({ width: 0.6, color: WOOD_DARK });
      grainLines(g, rng, 4.5, -5, 1.6, 1.4, 8, 6, WOOD_DARK, 0.3, 0.25);
      g.poly([1.5, -9.8, 0.3, -11.0, 2.5, -10.6]).fill(WOOD_DARK); // recurved nocks
      g.poly([1.5, 9.8, 0.3, 11.0, 2.5, 10.6]).fill(WOOD_DARK);
      g.moveTo(1.2, -10.1).lineTo(1.2, 10.1).stroke({ width: 0.5, color: 0xd8cfae }); // string
      g.circle(1.2, 0, 0.35).fill(0xa89060); // nocking-point whip
      drawFist(g, rng, false, 0.9);
      // leather riser-wrap over the grip: a band across the fist + stave
      g.rect(0.1, -1.7, 2.1, 3.4).fill(LEATHER).stroke({ width: 0.35, color: WOOD_DARK });
      for (let i = 0; i < 3; i++) {
        const x = 0.4 + i * 0.65;
        g.moveTo(x, -1.6).lineTo(x + 0.5, 1.6).stroke({ width: 0.25, color: OUTLINE, alpha: 0.5 });
      }
      break;
    }
    case 'swordsman': {
      // kite shield along the flank: teardrop body, riveted rim, wood grain,
      // emblem matching the surcoat's livery pattern, steel boss with a specular
      g.poly([-8.5, 0, -5.5, -3.1, 1.5, -3.5, 5.5, -1.8, 7, 0, 5.5, 1.8, 1.5, 3.5, -5.5, 3.1])
        .fill(t.cloth)
        .stroke({ width: 1.3, color: OUTLINE });
      paintedShade(g, -0.5, 0, 5.5, LIGHT_A, DARK_A, HIGHLIGHT, SHADOW);
      grainLines(g, rng, -1, 0, 5, 1.57, 6, 5, t.clothDark, 0.2, 0.3);
      rivets(g, -0.8, 0, 5.6, 8, t.trim);
      switch (variant % 4) {
        case 0: // cross
          wobblyLine(g, rng, -7, 0, 5.8, 0, 0.9, t.trim);
          wobblyLine(g, rng, 0, -3.2, 0, 3.2, 0.9, t.trim);
          break;
        case 1: // single fess bar
          wobblyLine(g, rng, -6.5, 0, 5.5, 0, 1.6, t.trim);
          break;
        case 2: // diagonal bend
          wobblyLine(g, rng, -4, -2.4, 4, 2.4, 1.4, t.trim);
          break;
        default: // plain — rim only, no charge
      }
      g.circle(0, 0, 1.15).fill(STEEL).stroke({ width: 0.5, color: STEEL_DARK }); // boss
      specular(g, Math.cos(LIGHT_A) * 0.4, Math.sin(LIGHT_A) * 0.4, 0.3, 0.75);
      break;
    }
    case 'pikeman':
      // forward grip on the pike shaft, wrapped for a sure hold
      wobblyLine(g, rng, -2, 0, 2, 0, 2.3, LEATHER);
      drawFist(g, rng, armored);
      break;
    default:
      drawFist(g, rng, armored || type.mounted);
  }
}

// A genuinely PRONE body — a fallen figure viewed from above has a long
// silhouette (head, torso, splayed legs), nothing like the round standing
// body's shoulder-width footprint. Reusing the standing texture for corpses
// is exactly why they used to just look "dead in place" instead of lying
// down. Drawn along local +x: head at the near end, legs splayed at the far.
function drawProneBody(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const r = type.radius;
  const armored = type.armor >= 2;
  const splay = rng.range(0.4, 0.85) * (rng.next() < 0.5 ? 1 : -1);

  // Legs: two tapering mail-clad limbs fanned from the hip, splayed unevenly
  // for a natural collapse rather than a symmetric mannequin pose.
  const hipX = r * 0.55;
  const legLen = r * 2.0;
  for (const side of [-1, 1] as const) {
    const bendX = hipX + legLen * 0.55;
    const bendY = side * r * (0.3 + Math.abs(splay) * 0.4);
    const spread = side === Math.sign(splay) ? 1.15 : 0.8;
    const footX = hipX + legLen * spread;
    const footY = side * r * (0.4 + Math.abs(splay) * 1.4);
    wobblyLine(g, rng, hipX, side * r * 0.22, bendX, bendY, r * 0.46, STEEL_DARK);
    wobblyLine(g, rng, bendX, bendY, footX, footY, r * 0.4, STEEL_DARK);
    g.moveTo(hipX, side * r * 0.22).quadraticCurveTo(bendX, bendY, footX, footY).stroke({
      width: r * 0.22,
      color: STEEL,
      alpha: 0.5,
    });
  }

  // Torso: elongated mail hauberk + surcoat capsule, form-shaded and grimed
  // like the standing body so it still reads as the same soldier.
  const torsoX = -r * 0.2;
  wobblyEllipse(g, rng, torsoX, 0, r * 1.2, r * 0.86, STEEL_DARK, OUTLINE, 1);
  wobblyEllipse(g, rng, torsoX, 0, r * 1.0, r * 0.68, t.cloth, t.clothDark, 1);
  paintedShade(g, torsoX, 0, r * 0.85, LIGHT_A, DARK_A, HIGHLIGHT, SHADOW);
  grime(g, rng, torsoX, 0, r * 0.95, 4, [0x5a4326, 0x3a2c18]);
  g.circle(-r * 0.28, 0, r * 0.5).fill(t.trim).stroke({ width: 0.4, color: WOOD_DARK }); // belt buckle

  // Head at the far end from the legs, turned to one side.
  const headX = -r * 2.25;
  const headY = rng.range(-0.45, 0.45) * r;
  wobblyCircle(g, rng, headX, headY, r * 0.5, STEEL_DARK, OUTLINE, 1);
  wobblyCircle(g, rng, headX, headY, r * 0.36, armored ? STEEL : 0x8a7250, STEEL_DARK, 0.7);
}

export function makePartSet(renderer: Renderer, team: number, type: UnitType, variant: number): PartSet {
  const seed = team * 977 + type.key.length * 131 + type.hp + variant * 5347;
  const r = type.radius;
  const bodyPart = bake(renderer, seed ^ 0x11, (g, rng) =>
    type.mounted ? drawHorseBody(g, rng, type, team, variant) : drawFootBody(g, rng, type, team, variant),
  );
  return {
    body: bodyPart,
    // Mounted corpses reuse the horse body (already an elongated top-down
    // silhouette, unlike the round human one, so it doesn't need a rebuild).
    corpse: type.mounted ? bodyPart : bake(renderer, seed ^ 0x55, (g, rng) => drawProneBody(g, rng, type, team)),
    handL: bake(renderer, seed ^ 0x22, (g, rng) => drawHandL(g, rng, type, team, variant)),
    handR: bake(renderer, seed ^ 0x33, (g, rng) => drawHandR(g, rng, type, team)),
    shadow: bake(renderer, seed ^ 0x44, (g) => {
      if (type.mounted) g.ellipse(0.1 * r, 0, r * 2.2, r * 1.0).fill({ color: 0x000000, alpha: 0.55 });
      else g.ellipse(0, 0, r * 1.2, r * 1.05).fill({ color: 0x000000, alpha: 0.55 });
    }),
    mounted: type.mounted,
  };
}

// --- The animated rig ---

interface Rig {
  root: Container;
  body: Sprite;
  hl: Sprite;
  hr: Sprite;
  spec: RigSpec;
  unit: UnitKey;
  radius: number;
  mounted: boolean;
  curRot: number;
  walkPhase: number;
  idlePhase: number;
  swingT: number;
  lastCooldown: number;
  lastReload: number;
  lastHp: number;
}

// A soldier's death is a brief stagger-and-fall, not an instant pop: he
// lurches from the hit, topples to a random sprawl angle, and only THEN
// becomes the static gore corpse — self-contained from the death event
// alone since the sim's Soldier object is already gone by the time we see it.
const DEATH_FALL_DURATION = 0.4;

interface DyingAnim {
  root: Container;
  t: number;
  startFacing: number;
  restFacing: number;
  lurchX: number;
  lurchY: number;
  x: number;
  y: number;
  team: number;
  unit: UnitKey;
  variant: number;
  parts: PartSet;
}

function mkSprite(part: Part): Sprite {
  const s = new Sprite(part.tex);
  s.anchor.set(part.ax, part.ay);
  return s;
}

export class SoldierLayer {
  readonly container = new Container();
  private rigs = new Map<number, Rig>();
  private parts = new Map<string, PartSet>();
  private dyingAnims: DyingAnim[] = [];
  private time = 0;

  constructor(renderer: Renderer, battle: Battle) {
    for (const squad of battle.squads) {
      const spec = rigSpec(squad.unitType);
      for (const s of squad.soldiers) {
        const set = this.partsFor(renderer, squad.team, squad.unitType, hashVariant(s.id));
        const root = new Container();
        const shadow = mkSprite(set.shadow);
        shadow.alpha = 0.3;
        const body = mkSprite(set.body);
        const hl = mkSprite(set.handL);
        const hr = mkSprite(set.handR);
        hl.position.set(spec.hl[0], spec.hl[1]);
        hr.position.set(spec.hr[0], spec.hr[1]);
        root.addChild(shadow, body, hl, hr);
        this.container.addChild(root);
        this.rigs.set(s.id, {
          root,
          body,
          hl,
          hr,
          spec,
          unit: squad.unitType.key,
          radius: squad.unitType.radius,
          mounted: squad.unitType.mounted,
          curRot: s.facing,
          walkPhase: (s.id % 7) * 0.9,
          idlePhase: (s.id % 11) * 0.7,
          swingT: 99,
          lastCooldown: s.cooldown,
          lastReload: s.reload,
          lastHp: s.hp,
        });
      }
    }
  }

  partsFor(renderer: Renderer, team: number, type: UnitType, variant: number): PartSet {
    const key = `${team}:${type.key}:${variant}`;
    let set = this.parts.get(key);
    if (!set) {
      set = makePartSet(renderer, team, type, variant);
      this.parts.set(key, set);
    }
    return set;
  }

  getParts(team: number, unit: UnitKey, variant: number): PartSet | undefined {
    return this.parts.get(`${team}:${unit}:${variant}`);
  }

  /** alpha = progress between sim ticks; gore receives hit events detected here. */
  update(battle: Battle, alpha: number, frameDt: number, gore: GoreLayer | null): void {
    this.time += frameDt;
    for (const squad of battle.squads) {
      const fleeing = squad.state !== 'steady';
      const fade = squad.state === 'steady' ? 1 : squad.state === 'routing' ? 0.78 : 0.5;
      const charging = squad.charging;
      const braced = squad.formation === 'wall';
      for (const s of squad.soldiers) {
        const rig = this.rigs.get(s.id);
        if (!rig) continue;
        const x = s.prevX + (s.x - s.prevX) * alpha;
        const y = s.prevY + (s.y - s.prevY) * alpha;
        rig.root.position.set(x, y);
        // Ease the facing instead of snapping — the biggest source of jitter.
        let rotDiff = s.facing - rig.curRot;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        rig.curRot += rotDiff * Math.min(1, frameDt * 8);
        rig.root.rotation = rig.curRot;
        rig.root.alpha = fade;

        // Blood on every wound.
        if (s.hp < rig.lastHp && gore) gore.addHitBlood(x, y, s.facing);
        rig.lastHp = s.hp;

        // Gait, scaled by real speed. Footmen bob laterally with counter-swinging
        // arms; horses surge forward-and-back in a low, smooth gallop rhythm.
        // A routed man's stride is longer and more frantic; a charging man
        // leans into the run.
        const speed = Math.hypot(s.vx, s.vy);
        const panicMult = fleeing ? 1.35 : 1;
        let armSwing: number;
        let stride: number;
        if (rig.mounted) {
          stride = Math.min(1, speed / 110);
          rig.walkPhase += frameDt * (1.6 + speed * 0.045) * panicMult;
          rig.body.position.x = Math.sin(rig.walkPhase) * 0.6 * stride + (charging ? 0.9 : 0);
          rig.body.position.y = Math.cos(rig.walkPhase * 2) * 0.15 * stride;
          armSwing = 0;
        } else {
          stride = Math.min(1, speed / 55);
          rig.walkPhase += frameDt * (2.2 + speed * 0.09) * panicMult;
          const bob = Math.sin(rig.walkPhase) * stride * panicMult;
          rig.body.position.y = bob * 0.5;
          rig.body.position.x = charging ? 1.1 : 0;
          armSwing = bob * 0.14;
        }

        // Idle: when nearly stationary, a slow weight-shift sway instead of a
        // frozen mannequin — breathing, resettling a grip, watching the field.
        rig.idlePhase += frameDt * 1.05;
        const idleAmount = 1 - stride;
        const idleSway = Math.sin(rig.idlePhase) * idleAmount;
        rig.body.rotation = idleSway * (rig.mounted ? 0.018 : 0.032);
        armSwing += idleSway * 0.045;
        if (rig.mounted) rig.body.position.y += Math.sin(rig.idlePhase * 0.6) * 0.18 * idleAmount;

        // Attack detection: the sim resets cooldown upward on a swing, reload on a shot.
        if (s.cooldown > rig.lastCooldown + 0.35) rig.swingT = 0;
        if (s.reload > rig.lastReload + 1 && rig.lastReload > -1) rig.swingT = 0;
        rig.lastCooldown = s.cooldown;
        rig.lastReload = s.reload;
        rig.swingT += frameDt;

        this.poseHands(rig, armSwing, charging, braced && rig.unit === 'swordsman');
      }
    }

    this.updateDeaths(frameDt, gore);
  }

  private poseHands(rig: Rig, armSwing: number, charging: boolean, braced: boolean): void {
    const t = rig.swingT;
    const { hl, hr, spec } = rig;
    let hrRot = armSwing;
    let hrX = 0;
    let hlRot = -armSwing * 0.7;
    let hlX = 0;
    let hlY = 0;

    // A charging weapon levels forward, ready for impact, instead of hanging
    // loose at the side.
    if (charging && t >= 0.55) {
      if (spec.anim === 'thrust' || spec.anim === 'lance') hrX += 1.2;
      else if (spec.anim === 'swing') hrRot += -0.18;
    }

    if (t < 0.55) {
      // Attack animation: wind-up, strike, recover — each phase eased so the
      // motion flows instead of snapping between keyframes.
      const ease = (u: number): number => u * u * (3 - 2 * u);
      const strike = (a: number, b: number): number =>
        t < 0.14
          ? ease(t / 0.14) * a
          : t < 0.3
            ? a + ease((t - 0.14) / 0.16) * (b - a)
            : b * (1 - ease((t - 0.3) / 0.25));
      switch (spec.anim) {
        case 'swing':
          hrRot += strike(-0.85, 1.15);
          break;
        case 'thrust':
        case 'lance':
          hrX += strike(-3.2, 5.5);
          break;
        case 'loose':
          hrX += strike(-3.5, 1.5);
          hlRot += strike(0, -0.12);
          break;
      }
    }

    // Shield wall: the swordsman's shield hand locks forward and square to
    // the front instead of relaxed at the hip — braced ranks holding the line.
    if (braced) {
      hlRot = -0.62 + hlRot * 0.15;
      hlX = 1.6;
      hlY = -1.2;
    }

    hr.rotation = hrRot;
    hr.position.set(spec.hr[0] + hrX, spec.hr[1]);
    hl.rotation = hlRot;
    hl.position.set(spec.hl[0] + hlX, spec.hl[1] + hlY);
  }

  removeById(id: number): void {
    const rig = this.rigs.get(id);
    if (rig) {
      rig.root.destroy({ children: true });
      this.rigs.delete(id);
    }
  }

  /** Kick off a death: stagger from the hit, then topple to a sprawl (gore.addDeath fires when it settles). */
  playDeath(renderer: Renderer, death: DeathEvent): void {
    const variant = hashVariant(death.id);
    const unitType = UNIT_TYPES[death.unit];
    const parts = this.partsFor(renderer, death.team, unitType, variant);
    const spec = rigSpec(unitType);
    const root = new Container();
    const body = mkSprite(parts.body);
    const hl = mkSprite(parts.handL);
    const hr = mkSprite(parts.handR);
    hl.position.set(spec.hl[0], spec.hl[1]);
    hr.position.set(spec.hr[0], spec.hr[1]);
    root.addChild(body, hl, hr);
    root.position.set(death.x, death.y);
    root.rotation = death.facing;
    this.container.addChild(root);

    const rng = new Rng(death.id * 7919);
    this.dyingAnims.push({
      root,
      t: 0,
      startFacing: death.facing,
      restFacing: death.facing + rng.range(-2.6, 2.6),
      lurchX: Math.cos(death.facing) * rng.range(2, 5),
      lurchY: Math.sin(death.facing) * rng.range(2, 5),
      x: death.x,
      y: death.y,
      team: death.team,
      unit: death.unit,
      variant,
      parts,
    });
  }

  private updateDeaths(frameDt: number, gore: GoreLayer | null): void {
    for (let i = this.dyingAnims.length - 1; i >= 0; i--) {
      const d = this.dyingAnims[i]!;
      d.t += frameDt;
      const k = Math.min(1, d.t / DEATH_FALL_DURATION);
      // Quick lurch from the impact, then a heavier topple into the sprawl —
      // two eased phases feel like a real fall, not a linear tip-over.
      const lurchK = Math.min(1, k / 0.35) ** 0.5;
      const fallK = k < 0.3 ? 0 : ((k - 0.3) / 0.7) ** 1.6;
      d.root.position.set(d.x + d.lurchX * lurchK, d.y + d.lurchY * lurchK);
      let rotDiff = d.restFacing - d.startFacing;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      d.root.rotation = d.startFacing + rotDiff * fallK;
      d.root.scale.set(1, 1 - fallK * 0.35);
      d.root.alpha = 1 - fallK * 0.15;
      if (k >= 1) {
        d.root.destroy({ children: true });
        this.dyingAnims.splice(i, 1);
        // Corpse spawns exactly where the fall animation settled (lurched
        // position), not the original hit point — otherwise it visibly pops
        // a few pixels sideways the instant the animation ends.
        gore?.addDeath(d.x + d.lurchX, d.y + d.lurchY, d.restFacing, d.parts);
      }
    }
  }
}

/** Redraws all missiles each frame: shadow on the ground track, shaft lifted on a visual arc. */
export function drawProjectiles(g: Graphics, battle: Battle, alpha: number): void {
  g.clear();
  for (const p of battle.projectiles) {
    const x = p.prevX + (p.x - p.prevX) * alpha;
    const y = p.prevY + (p.y - p.prevY) * alpha;
    const k = Math.min(1, (p.t + alpha / 30) / p.flightTime);
    const lift = p.arcHeight * 4 * k * (1 - k);
    const dx = p.tx - p.sx;
    const dy = p.ty - p.sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * 5;
    const uy = (dy / len) * 5;
    g.ellipse(x, y, 2.2, 1.4).fill({ color: 0x000000, alpha: 0.18 });
    g.moveTo(x - ux, y - uy - lift)
      .lineTo(x + ux, y + uy - lift)
      .stroke({ width: 1.6, color: 0x4a3b26 });
  }
}

