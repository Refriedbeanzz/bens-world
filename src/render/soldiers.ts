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

function rigSpec(type: UnitType): RigSpec {
  const r = type.radius;
  switch (type.key) {
    case 'pikeman':
      return { hl: [r * 1.0, -r * 0.35], hr: [-r * 0.1, r * 0.8], anim: 'thrust' };
    case 'archer':
      return { hl: [r * 0.9, -r * 0.3], hr: [r * 0.1, r * 0.55], anim: 'loose' };
    case 'crossbowman':
      return { hl: [r * 0.9, -r * 0.3], hr: [r * 0.35, r * 0.5], anim: 'loose' };
    case 'knight':
      return { hl: [r * 0.5, -r * 0.55], hr: [r * 0.2, r * 0.75], anim: 'lance' };
    case 'cavalry':
      return { hl: [r * 0.5, -r * 0.55], hr: [r * 0.2, r * 0.75], anim: 'swing' };
    default:
      return { hl: [r * 0.15, -r * 0.9], hr: [r * 0.15, r * 0.9], anim: 'swing' };
  }
}

function bake(renderer: Renderer, seed: number, draw: (g: Graphics, rng: Rng) => void): Part {
  const g = new Graphics();
  draw(g, new Rng(seed));
  const b = g.getLocalBounds();
  const tex = renderer.generateTexture({ target: g, resolution: 4 });
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
  // mail hauberk fringe under the surcoat
  wobblyCircle(g, rng, 0, 0, r * 1.04, STEEL_DARK, OUTLINE, 1.2);
  // team surcoat
  wobblyCircle(g, rng, 0, 0, r * 0.86, t.cloth, t.clothDark, 1);
  if (type.key === 'archer') {
    // quiver across the back
    wobblyEllipse(g, rng, -r * 0.55, r * 0.35, r * 0.42, r * 0.24, LEATHER, WOOD_DARK, 0.9);
    // hood + leather cap
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.55, LEATHER, OUTLINE, 1);
    wobblyCircle(g, rng, r * 0.2, 0, r * 0.34, WOOD, WOOD_DARK, 0.8);
  } else if (type.key === 'crossbowman') {
    // kettle helm: wide brim + crown
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.6, STEEL, STEEL_DARK, 1);
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.34, STEEL, STEEL_DARK, 0.8);
  } else {
    // nasal helm with a ridge along the facing
    wobblyCircle(g, rng, r * 0.16, 0, r * 0.55, STEEL, OUTLINE, 1);
    wobblyLine(g, rng, r * 0.68, 0, -r * 0.3, 0, 1, STEEL_DARK);
  }
}

function drawHorseBody(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const r = type.radius;
  const heavy = type.key === 'knight';
  // horse: caparisoned in team cloth for knights, bare with a saddle cloth for cavalry
  wobblyEllipse(g, rng, 0, 0, r * 1.7, r * 0.92, heavy ? t.cloth : HORSE_BROWN, OUTLINE, 1.2);
  if (heavy) {
    // caparison trim
    wobblyLine(g, rng, -r * 1.45, -r * 0.55, r * 1.2, -r * 0.55, 1, t.trim);
    wobblyLine(g, rng, -r * 1.45, r * 0.55, r * 1.2, r * 0.55, 1, t.trim);
  } else {
    wobblyEllipse(g, rng, -r * 0.15, 0, r * 0.6, r * 0.62, t.cloth, t.clothDark, 0.9);
  }
  // head (chanfron-armored for knights) + tail
  wobblyEllipse(g, rng, r * 1.75, 0, r * 0.5, r * 0.32, heavy ? STEEL : HORSE_BROWN, OUTLINE, 1);
  wobblyLine(g, rng, -r * 1.65, 0, -r * 2.05, rng.range(-2, 2), 1.4, heavy ? t.clothDark : 0x4a3520);
  // rider
  if (heavy) {
    // great helm: flat-topped steel drum
    wobblyCircle(g, rng, -r * 0.1, 0, r * 0.5, STEEL, OUTLINE, 1.1);
    wobblyLine(g, rng, -r * 0.1 + r * 0.45, -r * 0.18, -r * 0.1 + r * 0.45, r * 0.18, 0.9, STEEL_DARK);
  } else {
    wobblyCircle(g, rng, -r * 0.1, 0, r * 0.45, t.cloth, t.clothDark, 0.9);
    wobblyCircle(g, rng, -r * 0.05, 0, r * 0.3, STEEL, STEEL_DARK, 0.8);
  }
  // kite shield slung on the left flank
  wobblyEllipse(g, rng, -r * 0.35, -r * 0.75, r * 0.62, r * 0.3, t.cloth, OUTLINE, 1);
}

// --- Hands (fist + held weapon), drawn facing +x, fist at the origin ---

function drawFist(g: Graphics, rng: Rng, armored: boolean): void {
  wobblyCircle(g, rng, 0, 0, 2.7, armored ? STEEL : SKIN, OUTLINE, 1);
}

function drawHandR(g: Graphics, rng: Rng, type: UnitType): void {
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'pikeman':
      // 4m pike: long ash shaft with a leaf head
      wobblyLine(g, rng, -8, 0, 30, 0, 1.5, WOOD);
      g.poly([30, 0, 35, -1.6, 35, 1.6]).fill(STEEL).stroke({ width: 0.7, color: STEEL_DARK });
      drawFist(g, rng, armored);
      break;
    case 'archer':
      // drawing hand pinching an arrow
      wobblyLine(g, rng, 0, 0, 9, 0, 0.9, WOOD_DARK);
      drawFist(g, rng, false);
      break;
    case 'crossbowman': {
      // crossbow: stock + steel bow arms + string
      wobblyLine(g, rng, -3, 0, 12, 0, 2, WOOD);
      wobblyLine(g, rng, 8, -6.5, 8, 6.5, 1.4, STEEL);
      g.moveTo(8, -6.5).lineTo(2, 0).lineTo(8, 6.5).stroke({ width: 0.6, color: WOOD_DARK });
      drawFist(g, rng, false);
      break;
    }
    case 'knight':
      // couched lance with a pennon
      wobblyLine(g, rng, -5, 0, 36, 0, 1.6, WOOD);
      g.poly([36, 0, 39.5, -0.9, 39.5, 0.9]).fill(STEEL);
      g.poly([26, -0.8, 33, -0.8, 30, -4.6]).fill(teamOf(0).trim);
      drawFist(g, rng, true);
      break;
    case 'cavalry':
      // light spear
      wobblyLine(g, rng, -4, 0, 24, 0, 1.3, WOOD);
      g.poly([24, 0, 28, -1.3, 28, 1.3]).fill(STEEL).stroke({ width: 0.6, color: STEEL_DARK });
      drawFist(g, rng, armored);
      break;
    default: {
      // arming sword: blade, crossguard, grip
      wobblyLine(g, rng, 3, 0, 15.5, 0, 1.7, STEEL);
      g.poly([15.5, 0, 17.3, -0.8, 17.3, 0.8]).fill(STEEL);
      wobblyLine(g, rng, 3.4, -2.6, 3.4, 2.6, 1.2, STEEL_DARK);
      drawFist(g, rng, armored);
    }
  }
}

function drawHandL(g: Graphics, rng: Rng, type: UnitType, team: number): void {
  const t = teamOf(team);
  const armored = type.armor >= 2;
  switch (type.key) {
    case 'archer': {
      // self bow held out: stave arc + string
      g.moveTo(2, -9);
      g.quadraticCurveTo(7, 0, 2, 9);
      g.stroke({ width: 1.5, color: WOOD });
      g.moveTo(2, -9).lineTo(2, 9).stroke({ width: 0.5, color: 0xd8cfae });
      drawFist(g, rng, false);
      break;
    }
    case 'swordsman':
      // kite shield carried on the left
      wobblyEllipse(g, rng, 0.5, 0, 3.4, 7.6, t.cloth, OUTLINE, 1.2);
      wobblyLine(g, rng, 0.5, -6, 0.5, 6, 0.9, t.trim);
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
    handR: bake(renderer, seed ^ 0x33, (g, rng) => drawHandR(g, rng, type)),
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

