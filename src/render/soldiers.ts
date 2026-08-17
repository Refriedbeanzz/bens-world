import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Battle } from '../sim/battle';
import { Rng } from '../sim/rng';
import type { UnitKey, UnitType } from '../sim/unittype';
import type { GoreLayer } from './gore';
import {
  HORSE_BROWN,
  LEATHER,
  OUTLINE,
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
  // mail hauberk under everything, with stippled rings around the fringe
  wobblyCircle(g, rng, 0, 0, r * 1.02, STEEL_DARK, OUTLINE, 1.2);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng.range(-0.1, 0.1);
    g.circle(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93, 0.32).fill(STEEL);
  }
  // shoulder mail bumps where the (separate) arms attach
  wobblyCircle(g, rng, -r * 0.05, -r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  wobblyCircle(g, rng, -r * 0.05, r * 0.82, r * 0.3, STEEL_DARK, OUTLINE, 0.8);
  // team surcoat, quartered heraldically (darker front-right quarter)
  wobblyCircle(g, rng, 0, 0, r * 0.8, t.cloth, t.clothDark, 1);
  const quarter: number[] = [0, 0];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    quarter.push(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
  }
  g.poly(quarter).fill({ color: t.clothDark, alpha: 0.65 });
  // belt across the waist
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
    // mail coif, then a nasal helm: dome, rim, ridge, and the nasal bar forward
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.54, STEEL_DARK, OUTLINE, 0.9);
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.42, STEEL, STEEL_DARK, 1);
    wobblyLine(g, rng, -r * 0.2, 0, r * 0.52, 0, 0.8, STEEL_DARK); // crown ridge
    wobblyLine(g, rng, r * 0.55, 0, r * 0.85, 0, 1.1, STEEL); // nasal bar
  }
}

function drawHorseBody(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const r = type.radius;
  const heavy = type.key === 'knight';
  const coat = heavy ? t.cloth : HORSE_BROWN;
  // haunches + barrel: two overlapping masses read as a real horse from above
  wobblyEllipse(g, rng, -r * 0.9, 0, r * 0.85, r * 0.8, coat, OUTLINE, 1.2);
  wobblyEllipse(g, rng, r * 0.25, 0, r * 1.15, r * 0.72, coat, OUTLINE, 1.2);
  // neck tapering to the head
  g.poly([r * 0.9, -r * 0.42, r * 1.85, -r * 0.22, r * 1.85, r * 0.22, r * 0.9, r * 0.42])
    .fill(coat)
    .stroke({ width: 1.1, color: OUTLINE });
  // head with ears (chanfron-armored steel for knights)
  wobblyEllipse(g, rng, r * 2.0, 0, r * 0.42, r * 0.26, heavy ? STEEL : HORSE_BROWN, OUTLINE, 1);
  g.poly([r * 1.75, -r * 0.28, r * 1.62, -r * 0.48, r * 1.88, -r * 0.36]).fill(coat).stroke({ width: 0.7, color: OUTLINE });
  g.poly([r * 1.75, r * 0.28, r * 1.62, r * 0.48, r * 1.88, r * 0.36]).fill(coat).stroke({ width: 0.7, color: OUTLINE });
  // mane running down the neck's left side
  wobblyLine(g, rng, r * 0.85, -r * 0.34, r * 1.8, -r * 0.18, 1.3, heavy ? t.clothDark : 0x4a3520);
  // tail
  wobblyLine(g, rng, -r * 1.7, 0, -r * 2.15, rng.range(-2, 2), 1.4, heavy ? t.clothDark : 0x4a3520);
  if (heavy) {
    // caparison trim + scalloped hem dots
    wobblyLine(g, rng, -r * 1.5, -r * 0.62, r * 1.1, -r * 0.55, 0.9, t.trim);
    wobblyLine(g, rng, -r * 1.5, r * 0.62, r * 1.1, r * 0.55, 0.9, t.trim);
    for (let i = 0; i < 6; i++) {
      const x = -r * 1.4 + i * r * 0.42;
      g.circle(x, -r * 0.72, 0.45).fill(t.trim);
      g.circle(x, r * 0.72, 0.45).fill(t.trim);
    }
  } else {
    // saddle cloth in team colors with trim edge
    wobblyEllipse(g, rng, -r * 0.2, 0, r * 0.62, r * 0.6, t.cloth, t.clothDark, 0.9);
    wobblyLine(g, rng, -r * 0.72, -r * 0.5, -r * 0.72, r * 0.5, 0.8, t.trim);
  }
  // kite shield slung along the left flank
  g.poly([-r * 1.05, -r * 0.72, -r * 0.2, -r * 0.86, r * 0.25, -r * 0.72, -r * 0.4, -r * 0.6])
    .fill(t.cloth)
    .stroke({ width: 1, color: OUTLINE });
  // rider: shoulders + helm
  wobblyEllipse(g, rng, -r * 0.25, 0, r * 0.38, r * 0.52, t.cloth, t.clothDark, 0.9);
  if (heavy) {
    // flat-topped great helm with breath-slit cross
    wobblyCircle(g, rng, -r * 0.18, 0, r * 0.4, STEEL, OUTLINE, 1.1);
    wobblyLine(g, rng, -r * 0.18, -r * 0.3, -r * 0.18, r * 0.3, 0.7, STEEL_DARK);
    wobblyLine(g, rng, -r * 0.4, 0, r * 0.1, 0, 0.7, STEEL_DARK);
  } else {
    wobblyCircle(g, rng, -r * 0.18, 0, r * 0.34, STEEL, STEEL_DARK, 0.9);
    wobblyLine(g, rng, -r * 0.02, 0, r * 0.22, 0, 0.9, STEEL); // nasal
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
  return {
    body: bake(renderer, seed ^ 0x11, (g, rng) =>
      type.mounted ? drawHorseBody(g, rng, type, team) : drawFootBody(g, rng, type, team),
    ),
    handL: bake(renderer, seed ^ 0x22, (g, rng) => drawHandL(g, rng, type, team)),
    handR: bake(renderer, seed ^ 0x33, (g, rng) => drawHandR(g, rng, type, team)),
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
        const body = mkSprite(set.body);
        const hl = mkSprite(set.handL);
        const hr = mkSprite(set.handR);
        hl.position.set(spec.hl[0], spec.hl[1]);
        hr.position.set(spec.hr[0], spec.hr[1]);
        root.addChild(body, hl, hr);
        this.container.addChild(root);
        this.rigs.set(s.id, {
          root,
          body,
          hl,
          hr,
          spec,
          radius: squad.unitType.radius,
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
        rig.root.rotation = s.facing;
        rig.root.alpha = fade;

        // Blood on every wound.
        if (s.hp < rig.lastHp && gore) gore.addHitBlood(x, y, s.facing);
        rig.lastHp = s.hp;

        // Walk cycle: body bob + hands counter-swinging, scaled by real speed.
        const speed = Math.hypot(s.vx, s.vy);
        const stride = Math.min(1, speed / 60);
        rig.walkPhase += frameDt * (3 + speed * 0.16);
        const bob = Math.sin(rig.walkPhase) * stride;
        rig.body.position.y = bob * 0.9;
        const armSwing = bob * 0.22;

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
      // Attack animation: wind-up, strike, recover.
      const strike = (a: number, b: number): number =>
        t < 0.14
          ? (t / 0.14) * a
          : t < 0.3
            ? a + ((t - 0.14) / 0.16) * (b - a)
            : b * (1 - (t - 0.3) / 0.25);
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

