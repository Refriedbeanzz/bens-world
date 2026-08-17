import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Battle } from '../sim/battle';
import { Rng } from '../sim/rng';
import type { UnitKey, UnitType } from '../sim/unittype';
import type { GoreLayer } from './gore';
import {
  crescent,
  HORSE_BROWN,
  LEATHER,
  OUTLINE,
  rivets,
  SKIN,
  STEEL,
  STEEL_DARK,
  WOOD,
  WOOD_DARK,
  teamOf,
  wobblyCircle,
  wobblyEllipse,
  wobblyLine,
} from './style';

const HIGHLIGHT = 0xf2ead6;
const SHADOW = 0x1c150e;
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
  handL: Part;
  handR: Part;
  shadow: Part;
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
      // both hands gripping the shaft carried along the right side
      return { hl: [r * 1.0, r * 0.55], hr: [-r * 0.2, r * 0.72], anim: 'thrust' };
    case 'archer':
      return { hl: [r * 1.0, -r * 0.35], hr: [r * 0.15, r * 0.5], anim: 'loose' };
    case 'crossbowman':
      return { hl: [r * 0.55, -r * 0.4], hr: [r * 0.9, r * 0.15], anim: 'loose' };
    case 'knight':
      return { hl: [r * 0.6, -r * 0.7], hr: [r * 0.1, r * 0.8], anim: 'lance' };
    case 'cavalry':
      return { hl: [r * 0.6, -r * 0.7], hr: [r * 0.1, r * 0.8], anim: 'swing' };
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

function drawFootBody(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const r = type.radius;
  // mail hauberk under everything, densely stippled (two interlocking rings of dots)
  wobblyCircle(g, rng, 0, 0, r * 1.02, STEEL_DARK, OUTLINE, 1.2);
  for (let ring = 0; ring < 2; ring++) {
    const rr = r * (0.96 - ring * 0.075);
    const n = 22 - ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.14 + rng.range(-0.05, 0.05);
      g.circle(Math.cos(a) * rr, Math.sin(a) * rr, 0.26).fill(STEEL);
    }
  }
  // shoulder mail bumps where the (separate) arms attach
  wobblyCircle(g, rng, -r * 0.05, -r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  wobblyCircle(g, rng, -r * 0.05, r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  g.circle(-r * 0.05 + Math.cos(LIGHT_A) * r * 0.12, -r * 0.82 + Math.sin(LIGHT_A) * r * 0.12, r * 0.09).fill({ color: HIGHLIGHT, alpha: 0.35 });
  g.circle(-r * 0.05 + Math.cos(LIGHT_A) * r * 0.12, r * 0.82 + Math.sin(LIGHT_A) * r * 0.12, r * 0.09).fill({ color: HIGHLIGHT, alpha: 0.35 });
  // team surcoat, quartered heraldically, with form shading and cloth folds
  wobblyCircle(g, rng, 0, 0, r * 0.8, t.cloth, t.clothDark, 1);
  const quarter: number[] = [0, 0];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    quarter.push(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
  }
  g.poly(quarter).fill({ color: t.clothDark, alpha: 0.65 });
  crescent(g, 0, 0, r * 0.78, LIGHT_A, 1.15, r * 0.22, HIGHLIGHT, 0.22);
  crescent(g, 0, 0, r * 0.78, DARK_A, 1.15, r * 0.22, SHADOW, 0.2);
  // cloth folds
  g.moveTo(-r * 0.55, -r * 0.35).quadraticCurveTo(-r * 0.2, -r * 0.15, -r * 0.6, r * 0.1).stroke({ width: 0.5, color: t.clothDark });
  g.moveTo(-r * 0.5, r * 0.4).quadraticCurveTo(-r * 0.25, r * 0.3, -r * 0.55, r * 0.05).stroke({ width: 0.45, color: t.clothDark });
  // belt across the waist with a trim buckle
  wobblyLine(g, rng, -r * 0.28, -r * 0.72, -r * 0.28, r * 0.72, 1.1, WOOD_DARK);
  g.circle(-r * 0.28, 0, 0.55).fill(t.trim);

  if (type.key === 'archer') {
    // quiver slung across the back, arrows poking out
    wobblyEllipse(g, rng, -r * 0.6, r * 0.4, r * 0.45, r * 0.22, LEATHER, WOOD_DARK, 0.9);
    for (let i = 0; i < 3; i++) {
      const qy = r * 0.28 + i * r * 0.12;
      g.circle(-r * 0.98, qy, 0.4).fill(t.trim);
    }
    // hood down + leather cap
    wobblyCircle(g, rng, r * 0.18, 0, r * 0.52, STEEL_DARK, OUTLINE, 0.9); // mail coif
    wobblyCircle(g, rng, r * 0.2, 0, r * 0.4, LEATHER, WOOD_DARK, 0.9);
    wobblyLine(g, rng, r * 0.2, -r * 0.36, r * 0.2, r * 0.36, 0.7, WOOD_DARK);
  } else if (type.key === 'crossbowman') {
    // kettle helm: broad brim ring with a raised crown
    wobblyCircle(g, rng, r * 0.18, 0, r * 0.58, STEEL_DARK, OUTLINE, 1);
    wobblyCircle(g, rng, r * 0.18, 0, r * 0.44, STEEL, STEEL_DARK, 0.9);
    wobblyCircle(g, rng, r * 0.18, 0, r * 0.24, STEEL, STEEL_DARK, 0.7);
  } else {
    // mail coif, then a nasal helm: dome, rim rivets, ridge, nasal bar, specular
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.54, STEEL_DARK, OUTLINE, 0.9);
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.42, STEEL, STEEL_DARK, 1);
    rivets(g, r * 0.16, 0, r * 0.36, 6, STEEL_DARK);
    wobblyLine(g, rng, -r * 0.2, 0, r * 0.52, 0, 0.8, STEEL_DARK); // crown ridge
    wobblyLine(g, rng, r * 0.55, 0, r * 0.85, 0, 1.1, STEEL); // nasal bar
    g.circle(r * 0.16 + Math.cos(LIGHT_A) * r * 0.2, Math.sin(LIGHT_A) * r * 0.2, r * 0.1).fill({ color: HIGHLIGHT, alpha: 0.5 });
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

function drawHorseBody(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const r = type.radius;
  const heavy = type.key === 'knight';
  const coat = heavy ? t.cloth : HORSE_BROWN;

  // tail: a full flowing shape (not a stray line) with inner strands
  const tailColor = heavy ? t.clothDark : 0x4a3520;
  g.poly([
    -r * 1.8, -r * 0.16,
    -r * 2.5, -r * 0.32,
    -r * 2.7, 0,
    -r * 2.5, r * 0.32,
    -r * 1.8, r * 0.16,
  ]).fill(tailColor).stroke({ width: 0.8, color: OUTLINE });
  wobblyLine(g, rng, -r * 2.0, -r * 0.08, -r * 2.55, -r * 0.14, 0.5, heavy ? t.cloth : 0x3a2a18);
  wobblyLine(g, rng, -r * 2.0, r * 0.1, -r * 2.55, r * 0.16, 0.5, heavy ? t.cloth : 0x3a2a18);

  // one continuous body silhouette
  g.poly(horseOutline(r, rng)).fill(coat).stroke({ width: 1.25, color: OUTLINE });

  // ears: two small triangles just behind the head, angled outward
  g.poly([r * 1.86, -r * 0.2, r * 1.7, -r * 0.42, r * 1.98, -r * 0.28]).fill(coat).stroke({ width: 0.6, color: OUTLINE });
  g.poly([r * 1.86, r * 0.2, r * 1.7, r * 0.42, r * 1.98, r * 0.28]).fill(coat).stroke({ width: 0.6, color: OUTLINE });

  // muscle shading: shadow along the right flank, light along the left
  crescent(g, -r * 0.9, 0, r * 0.68, DARK_A, 1.0, r * 0.18, SHADOW, 0.2);
  crescent(g, r * 0.3, 0, r * 0.52, LIGHT_A, 0.9, r * 0.14, HIGHLIGHT, 0.16);
  // haunch and shoulder muscle lines
  g.moveTo(-r * 0.5, -r * 0.5).quadraticCurveTo(-r * 0.3, 0, -r * 0.5, r * 0.5).stroke({ width: 0.5, color: OUTLINE });
  g.moveTo(r * 0.85, -r * 0.4).quadraticCurveTo(r * 0.95, 0, r * 0.85, r * 0.4).stroke({ width: 0.45, color: OUTLINE });

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
    .fill(heavy ? STEEL : HORSE_BROWN)
    .stroke({ width: 0.9, color: OUTLINE });
  if (heavy) {
    wobblyLine(g, rng, r * 1.95, 0, r * 2.45, 0, 0.6, STEEL_DARK); // chanfron ridge
    g.circle(r * 2.15 + Math.cos(LIGHT_A) * 0.3, Math.sin(LIGHT_A) * 0.3, 0.35).fill({ color: HIGHLIGHT, alpha: 0.5 });
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
    wobblyLine(g, rng, x, yTop, x - r * 0.08, yTop - r * 0.14, 0.9, heavy ? t.clothDark : 0x4a3520);
  }

  if (heavy) {
    // caparison: trim border following the body, scalloped hem dots
    const border = horseOutline(r * 0.86, rng);
    g.poly(border).stroke({ width: 0.8, color: t.trim });
    for (let i = 0; i < 7; i++) {
      const x = -r * 1.5 + i * r * 0.45;
      g.circle(x, -r * 0.66 + Math.abs(x) * 0.04, 0.42).fill(t.trim);
      g.circle(x, r * 0.66 - Math.abs(x) * 0.04, 0.42).fill(t.trim);
    }
  } else {
    // saddle cloth under the rider, trimmed edges
    g.poly([-r * 0.62, -r * 0.58, r * 0.42, -r * 0.52, r * 0.42, r * 0.52, -r * 0.62, r * 0.58])
      .fill(t.cloth)
      .stroke({ width: 0.8, color: t.clothDark });
    wobblyLine(g, rng, -r * 0.55, -r * 0.52, -r * 0.55, r * 0.52, 0.7, t.trim);
    wobblyLine(g, rng, r * 0.35, -r * 0.48, r * 0.35, r * 0.48, 0.7, t.trim);
  }

  // kite shield slung along the left flank
  g.poly([-r * 0.95, -r * 0.6, -r * 0.35, -r * 0.78, r * 0.2, -r * 0.66, -r * 0.35, -r * 0.52])
    .fill(t.cloth)
    .stroke({ width: 1, color: OUTLINE });
  g.circle(-r * 0.35, -r * 0.65, 0.6).fill(STEEL);

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
  crescent(g, rx, 0, r * 0.4, LIGHT_A, 0.9, r * 0.12, HIGHLIGHT, 0.3);
  crescent(g, rx, 0, r * 0.4, DARK_A, 0.9, r * 0.1, SHADOW, 0.18);
  // shoulders peeking past the cloak edge
  g.circle(rx - r * 0.1, -r * 0.32, r * 0.13).fill(t.clothDark);
  g.circle(rx - r * 0.1, r * 0.32, r * 0.13).fill(t.clothDark);
  if (heavy) {
    // flat-topped great helm, sat higher and larger than before, breath-slit
    // cross, rim rivets, and a highlight so it pops against the body below
    wobblyCircle(g, rng, rx, 0, r * 0.4, STEEL, OUTLINE, 1.2);
    rivets(g, rx, 0, r * 0.32, 6, STEEL_DARK);
    wobblyLine(g, rng, rx, -r * 0.29, rx, r * 0.29, 0.7, STEEL_DARK);
    wobblyLine(g, rng, rx - r * 0.27, 0, rx + r * 0.22, 0, 0.7, STEEL_DARK);
    g.circle(rx + Math.cos(LIGHT_A) * r * 0.2, Math.sin(LIGHT_A) * r * 0.2, r * 0.1).fill({ color: HIGHLIGHT, alpha: 0.55 });
  } else {
    wobblyCircle(g, rng, rx, 0, r * 0.33, STEEL, STEEL_DARK, 1);
    wobblyLine(g, rng, rx + r * 0.14, 0, rx + r * 0.38, 0, 0.9, STEEL); // nasal
    g.circle(rx + Math.cos(LIGHT_A) * r * 0.14, Math.sin(LIGHT_A) * r * 0.14, r * 0.08).fill({ color: HIGHLIGHT, alpha: 0.55 });
  }
}

// --- Hands (fist + held weapon), drawn facing +x, fist at the origin ---

function drawFist(g: Graphics, rng: Rng, armored: boolean): void {
  wobblyCircle(g, rng, 0, 0, 1.9, armored ? STEEL : SKIN, OUTLINE, 0.9);
  // knuckle line so it reads as a gripping hand, not a dot
  wobblyLine(g, rng, -0.6, -1.2, -0.6, 1.2, 0.5, armored ? STEEL_DARK : 0xa87f5e);
}

function drawSpearhead(g: Graphics, x: number, len: number, w: number): void {
  g.poly([x + len, 0, x, -w, x + len * 0.25, 0, x, w])
    .fill(STEEL)
    .stroke({ width: 0.6, color: STEEL_DARK });
}

function drawHandR(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'pikeman':
      // 4m ash pike: two-tone shaft, langets, leaf head with midrib
      wobblyLine(g, rng, -9, 0, 29, 0, 1.6, WOOD);
      wobblyLine(g, rng, -9, -0.5, 29, -0.5, 0.5, WOOD_DARK);
      wobblyLine(g, rng, 26, 0, 30.5, 0, 1, STEEL_DARK); // langets
      drawSpearhead(g, 30, 6.5, 1.9);
      wobblyLine(g, rng, 30.5, 0, 35.6, 0, 0.4, 0xc8ccd2); // midrib glint
      drawFist(g, rng, armored);
      break;
    case 'archer':
      // drawing hand pinching a fletched arrow
      wobblyLine(g, rng, -1, 0, 8.5, 0, 0.8, WOOD_DARK);
      g.poly([-1, 0, -3, -1.3, -2, 0, -3, 1.3]).fill(t.trim); // fletching
      g.poly([8.5, 0, 10.2, -0.7, 10.2, 0.7]).fill(STEEL);
      drawFist(g, rng, false);
      break;
    case 'crossbowman': {
      // crossbow held forward: wooden tiller, steel prod, string to the nut, bolt
      g.poly([-4, -1.4, 10, -0.9, 10, 0.9, -4, 1.4]).fill(WOOD).stroke({ width: 0.8, color: WOOD_DARK });
      g.moveTo(6, -7).quadraticCurveTo(9.5, 0, 6, 7).stroke({ width: 1.7, color: STEEL });
      g.circle(6, -7, 0.7).fill(STEEL_DARK);
      g.circle(6, 7, 0.7).fill(STEEL_DARK);
      g.moveTo(6, -7).lineTo(0, 0).lineTo(6, 7).stroke({ width: 0.6, color: 0xd8cfae }); // string
      wobblyLine(g, rng, 1, 0, 9, 0, 0.7, WOOD_DARK); // bolt in the channel
      g.poly([9, 0, 10.6, -0.6, 10.6, 0.6]).fill(STEEL);
      drawFist(g, rng, false);
      break;
    }
    case 'knight': {
      // couched lance: tapered shaft, steel vamplate at the grip, team pennon
      g.poly([-6, -1.2, 37, -0.45, 37, 0.45, -6, 1.2]).fill(WOOD).stroke({ width: 0.7, color: WOOD_DARK });
      g.poly([1.5, -2.6, 4.5, -1.1, 4.5, 1.1, 1.5, 2.6]).fill(STEEL).stroke({ width: 0.6, color: STEEL_DARK }); // vamplate
      drawSpearhead(g, 37, 4.5, 1.2);
      g.poly([25, -0.7, 33, -0.7, 28.5, -5.2]).fill(t.cloth).stroke({ width: 0.6, color: t.clothDark }); // pennon
      drawFist(g, rng, true);
      break;
    }
    case 'cavalry':
      // light spear with a hand-stop wrap
      wobblyLine(g, rng, -5, 0, 23, 0, 1.3, WOOD);
      wobblyLine(g, rng, 2.5, -1.4, 2.5, 1.4, 0.9, LEATHER);
      drawSpearhead(g, 23, 5, 1.5);
      drawFist(g, rng, armored);
      break;
    default: {
      // arming sword: round pommel, leather grip, crossguard, fullered blade
      g.circle(-3.1, 0, 1.1).fill(STEEL_DARK).stroke({ width: 0.5, color: OUTLINE }); // pommel
      wobblyLine(g, rng, -2.4, 0, 1.6, 0, 1.3, LEATHER); // grip
      wobblyLine(g, rng, 2, -3, 2, 3, 1.2, STEEL_DARK); // crossguard
      g.poly([2.6, -1.05, 14.5, -0.6, 16.8, 0, 14.5, 0.6, 2.6, 1.05]) // blade
        .fill(STEEL)
        .stroke({ width: 0.6, color: STEEL_DARK });
      wobblyLine(g, rng, 3, 0, 13.5, 0, 0.45, STEEL_DARK); // fuller
      wobblyLine(g, rng, 3, -0.75, 13, -0.45, 0.35, 0xd2d6da); // edge glint
      drawFist(g, rng, armored);
    }
  }
}

function drawHandL(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'archer': {
      // self bow held out: thick stave with recurved nocks, string, arrow rest
      g.moveTo(1.5, -9.5);
      g.quadraticCurveTo(7.5, 0, 1.5, 9.5);
      g.stroke({ width: 1.9, color: WOOD });
      g.moveTo(2.2, -8.5);
      g.quadraticCurveTo(7.2, 0, 2.2, 8.5);
      g.stroke({ width: 0.6, color: WOOD_DARK });
      g.poly([1.5, -9.5, 0.4, -10.6, 2.4, -10.2]).fill(WOOD_DARK); // nocks
      g.poly([1.5, 9.5, 0.4, 10.6, 2.4, 10.2]).fill(WOOD_DARK);
      g.moveTo(1.2, -9.8).lineTo(1.2, 9.8).stroke({ width: 0.5, color: 0xd8cfae }); // string
      drawFist(g, rng, false);
      break;
    }
    case 'swordsman': {
      // kite shield along the flank: teardrop, rim, steel boss, heraldic cross
      g.poly([-8.5, 0, -5.5, -3.1, 1.5, -3.5, 5.5, -1.8, 7, 0, 5.5, 1.8, 1.5, 3.5, -5.5, 3.1])
        .fill(t.cloth)
        .stroke({ width: 1.3, color: OUTLINE });
      wobblyLine(g, rng, -7, 0, 5.8, 0, 0.9, t.trim);
      wobblyLine(g, rng, 0, -3.2, 0, 3.2, 0.9, t.trim);
      g.circle(0, 0, 1.15).fill(STEEL).stroke({ width: 0.5, color: STEEL_DARK }); // boss
      break;
    }
    case 'pikeman':
      // forward grip on the pike shaft
      drawFist(g, rng, armored);
      break;
    default:
      drawFist(g, rng, armored || type.mounted);
  }
}

export function makePartSet(renderer: Renderer, team: number, type: UnitType): PartSet {
  const seed = team * 977 + type.key.length * 131 + type.hp;
  const r = type.radius;
  return {
    body: bake(renderer, seed ^ 0x11, (g, rng) =>
      type.mounted ? drawHorseBody(g, rng, type, team) : drawFootBody(g, rng, type, team),
    ),
    handL: bake(renderer, seed ^ 0x22, (g, rng) => drawHandL(g, rng, type, team)),
    handR: bake(renderer, seed ^ 0x33, (g, rng) => drawHandR(g, rng, type, team)),
    shadow: bake(renderer, seed ^ 0x44, (g) => {
      if (type.mounted) g.ellipse(0.1 * r, 0, r * 2.2, r * 1.0).fill({ color: 0x000000, alpha: 0.55 });
      else g.ellipse(0, 0, r * 1.2, r * 1.05).fill({ color: 0x000000, alpha: 0.55 });
    }),
  };
}

// --- The animated rig ---

interface Rig {
  root: Container;
  body: Sprite;
  hl: Sprite;
  hr: Sprite;
  spec: RigSpec;
  radius: number;
  mounted: boolean;
  curRot: number;
  walkPhase: number;
  swingT: number;
  lastCooldown: number;
  lastReload: number;
  lastHp: number;
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
  private time = 0;

  constructor(renderer: Renderer, battle: Battle) {
    for (const squad of battle.squads) {
      const set = this.partsFor(renderer, squad.team, squad.unitType);
      const spec = rigSpec(squad.unitType);
      for (const s of squad.soldiers) {
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
          radius: squad.unitType.radius,
          mounted: squad.unitType.mounted,
          curRot: s.facing,
          walkPhase: (s.id % 7) * 0.9,
          swingT: 99,
          lastCooldown: s.cooldown,
          lastReload: s.reload,
          lastHp: s.hp,
        });
      }
    }
  }

  partsFor(renderer: Renderer, team: number, type: UnitType): PartSet {
    const key = `${team}:${type.key}`;
    let set = this.parts.get(key);
    if (!set) {
      set = makePartSet(renderer, team, type);
      this.parts.set(key, set);
    }
    return set;
  }

  getParts(team: number, unit: UnitKey): PartSet | undefined {
    return this.parts.get(`${team}:${unit}`);
  }

  /** alpha = progress between sim ticks; gore receives hit events detected here. */
  update(battle: Battle, alpha: number, frameDt: number, gore: GoreLayer | null): void {
    this.time += frameDt;
    for (const squad of battle.squads) {
      const fade = squad.state === 'steady' ? 1 : squad.state === 'routing' ? 0.78 : 0.5;
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
        const speed = Math.hypot(s.vx, s.vy);
        let armSwing: number;
        if (rig.mounted) {
          const stride = Math.min(1, speed / 110);
          rig.walkPhase += frameDt * (1.6 + speed * 0.045);
          rig.body.position.x = Math.sin(rig.walkPhase) * 0.6 * stride;
          rig.body.position.y = Math.cos(rig.walkPhase * 2) * 0.15 * stride;
          armSwing = 0;
        } else {
          const stride = Math.min(1, speed / 55);
          rig.walkPhase += frameDt * (2.2 + speed * 0.09);
          const bob = Math.sin(rig.walkPhase) * stride;
          rig.body.position.y = bob * 0.5;
          armSwing = bob * 0.14;
        }

        // Attack detection: the sim resets cooldown upward on a swing, reload on a shot.
        if (s.cooldown > rig.lastCooldown + 0.35) rig.swingT = 0;
        if (s.reload > rig.lastReload + 1 && rig.lastReload > -1) rig.swingT = 0;
        rig.lastCooldown = s.cooldown;
        rig.lastReload = s.reload;
        rig.swingT += frameDt;

        this.poseHands(rig, armSwing);
      }
    }
  }

  private poseHands(rig: Rig, armSwing: number): void {
    const t = rig.swingT;
    const { hl, hr, spec } = rig;
    let hrRot = armSwing;
    let hrX = 0;
    let hlRot = -armSwing * 0.7;

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
          hrX = strike(-3.2, 5.5);
          break;
        case 'loose':
          hrX = strike(-3.5, 1.5);
          hlRot += strike(0, -0.12);
          break;
      }
    }
    hr.rotation = hrRot;
    hr.position.set(spec.hr[0] + hrX, spec.hr[1]);
    hl.rotation = hlRot;
  }

  removeById(id: number): void {
    const rig = this.rigs.get(id);
    if (rig) {
      rig.root.destroy({ children: true });
      this.rigs.delete(id);
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

