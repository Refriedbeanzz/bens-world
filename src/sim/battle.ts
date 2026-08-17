import { Rng } from './rng';
import { SpatialGrid } from './spatialgrid';
import { STANCE_SURGE, Squad } from './squad';
import {
  MELEE_ENGAGE,
  MELEE_PURSUE,
  MELEE_REACH,
  SOLDIER_RADIUS,
  type Soldier,
} from './soldier';
import type { UnitKey } from './unittype';
import { World } from './world';

export const PLAYER_TEAM = 0;

const AI_THINK_INTERVAL = 2; // seconds between enemy decisions
const AI_AGGRO_RANGE = 550;
// A routed squad rallies after this much continuous breathing room.
const RALLY_ENEMY_DISTANCE = 380;
const RALLY_TIME = 4;

export interface DeathEvent {
  id: number;
  x: number;
  y: number;
  team: number;
  escaped: boolean;
}

export interface SquadSpec {
  team: number;
  count: number;
  /** fractions of map width/height */
  x: number;
  y: number;
  facing: number;
  formation: 'line' | 'column' | 'wedge' | 'square' | 'wall' | 'loose' | 'circle';
  /** unit type; defaults to swordsman */
  type?: UnitKey;
}

const DEFAULT_SETUP: SquadSpec[] = [
  { team: 0, count: 50, x: 0.22, y: 0.3, facing: 0, formation: 'line', type: 'swordsman' },
  { team: 0, count: 50, x: 0.22, y: 0.5, facing: 0, formation: 'line', type: 'pikeman' },
  { team: 0, count: 40, x: 0.15, y: 0.4, facing: 0, formation: 'loose', type: 'archer' },
  { team: 0, count: 24, x: 0.18, y: 0.72, facing: 0, formation: 'wedge', type: 'cavalry' },
  { team: 1, count: 50, x: 0.78, y: 0.3, facing: Math.PI, formation: 'line', type: 'swordsman' },
  { team: 1, count: 50, x: 0.78, y: 0.5, facing: Math.PI, formation: 'line', type: 'pikeman' },
  { team: 1, count: 40, x: 0.85, y: 0.4, facing: Math.PI, formation: 'loose', type: 'crossbowman' },
  { team: 1, count: 20, x: 0.82, y: 0.72, facing: Math.PI, formation: 'wedge', type: 'knight' },
];

// A missile in flight: straight-line ground track, the arc is purely visual.
export interface Projectile {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  flightTime: number;
  damage: [number, number];
  pierce: boolean;
  team: number;
  arcHeight: number;
}

const PROJECTILE_HIT_RADIUS = 12;
const CHARGING_MISSILE_VULNERABILITY = 1.5;

// The whole battle state: world + squads. One tick() advances everything.
export class Battle {
  readonly world: World;
  readonly squads: Squad[] = [];
  readonly projectiles: Projectile[] = [];
  private allSoldiers: Soldier[] = [];
  private readonly soldierById = new Map<number, Soldier>();
  private readonly squadOf = new Map<number, Squad>();
  private readonly grid: SpatialGrid;
  private readonly rng: Rng;
  private readonly pendingDeaths: DeathEvent[] = [];
  private aiClock = 0;
  private nextSoldierId = 1;

  constructor(seed: number, setup: SquadSpec[] = DEFAULT_SETUP) {
    this.world = new World(seed);
    this.rng = new Rng(seed ^ 0x5eed);
    this.grid = new SpatialGrid(this.world.widthPx, this.world.heightPx);

    const allocId = () => this.nextSoldierId++;
    for (const spec of setup) {
      this.squads.push(
        new Squad(
          spec.team,
          spec.type ?? 'swordsman',
          spec.count,
          this.world.widthPx * spec.x,
          this.world.heightPx * spec.y,
          spec.facing,
          spec.formation,
          allocId,
        ),
      );
    }
    for (const squad of this.squads) {
      for (const s of squad.soldiers) {
        this.allSoldiers.push(s);
        this.soldierById.set(s.id, s);
        this.squadOf.set(s.id, squad);
      }
    }
  }

  /** The player squad whose soldiers are under this point, or null. */
  playerSquadAt(x: number, y: number): Squad | null {
    return this.squadAt(x, y, (squad) => squad.team === PLAYER_TEAM);
  }

  /** The enemy squad whose soldiers are under this point, or null. */
  enemySquadAt(x: number, y: number): Squad | null {
    return this.squadAt(x, y, (squad) => squad.team !== PLAYER_TEAM);
  }

  private squadAt(x: number, y: number, match: (squad: Squad) => boolean): Squad | null {
    const hitRadius = SOLDIER_RADIUS * 2.5;
    for (const squad of this.squads) {
      if (!match(squad)) continue;
      for (const s of squad.soldiers) {
        const dx = s.x - x;
        const dy = s.y - y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) return squad;
      }
    }
    return null;
  }

  /** Deaths and escapes since last asked — the renderer consumes these. */
  consumeDeaths(): DeathEvent[] {
    return this.pendingDeaths.splice(0);
  }

  tick(dt: number): void {
    this.enemyAI(dt);
    const lookup = (id: number) => this.soldierById.get(id);
    for (const squad of this.squads) squad.tick(dt, this.world, lookup);
    this.grid.rebuild(this.allSoldiers);
    this.combat(dt);
    this.rangedFire(dt);
    this.tickProjectiles(dt);
    this.separateSoldiers();
    this.resolveObstaclesAndBounds();
    this.cullDead();
    this.rallyRoutedSquads(dt);
    this.idleFacing(dt);
  }

  // A halted squad slowly fronts toward the nearest enemy formation — no one
  // stands around showing an enemy their backs.
  private idleFacing(dt: number): void {
    const range2 = 700 * 700;
    for (const squad of this.squads) {
      if (!squad.isIdle() || squad.soldiers.length === 0) continue;
      let best: Squad | null = null;
      let bestD2 = range2;
      for (const other of this.squads) {
        if (other.team === squad.team || other.soldiers.length === 0 || other.state !== 'steady') continue;
        const d2 = (other.anchorX - squad.anchorX) ** 2 + (other.anchorY - squad.anchorY) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = other;
        }
      }
      if (best) {
        squad.faceToward(
          Math.atan2(best.anchorY - squad.anchorY, best.anchorX - squad.anchorX),
          dt,
        );
      }
    }
  }

  // Routed squads that shake their pursuers regroup and rejoin the battle.
  private rallyRoutedSquads(dt: number): void {
    for (const squad of this.squads) {
      if (squad.state !== 'routing' || squad.soldiers.length === 0) continue;
      let cx = 0;
      let cy = 0;
      for (const s of squad.soldiers) {
        cx += s.x;
        cy += s.y;
      }
      cx /= squad.soldiers.length;
      cy /= squad.soldiers.length;
      const threat = this.grid.nearestEnemy(cx, cy, squad.team, RALLY_ENEMY_DISTANCE);
      if (threat) {
        squad.rallyProgress = 0;
      } else {
        squad.rallyProgress += dt;
        if (squad.rallyProgress >= RALLY_TIME) squad.rally();
      }
    }
  }

  // Enemy squads advance on the nearest player squad once it's in aggro range.
  private enemyAI(dt: number): void {
    this.aiClock += dt;
    if (this.aiClock < AI_THINK_INTERVAL) return;
    this.aiClock = 0;
    for (const squad of this.squads) {
      if (squad.team === PLAYER_TEAM || squad.state !== 'steady' || squad.soldiers.length === 0) continue;
      // Ranged squads hold their ground and shoot; only melee squads advance.
      if (squad.unitType.ranged) continue;
      let best: Squad | null = null;
      let bestD2 = AI_AGGRO_RANGE * AI_AGGRO_RANGE;
      for (const other of this.squads) {
        if (other.team !== PLAYER_TEAM || other.state !== 'steady' || other.soldiers.length === 0) continue;
        const d2 = (other.anchorX - squad.anchorX) ** 2 + (other.anchorY - squad.anchorY) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = other;
        }
      }
      if (best && !squad.isAttacking(best)) {
        squad.orderAttack(best, this.world);
        // Horsemen come in at the gallop.
        if (squad.unitType.mounted && bestD2 < 450 * 450) squad.startCharge();
      }
    }
  }

  // Melee. Front soldiers quietly acquire within ENGAGE; the moment a squad has
  // contact, the whole squad acquires out to SURGE and piles into the fight —
  // no more back ranks standing around watching the front rank brawl.
  private combat(dt: number): void {
    // Gang-up census (last tick's targets): how many attackers press each victim.
    // A mobbed soldier can't parry five blades — every extra attacker past the
    // first adds +30% damage taken, capped at 2.5x.
    const attackersOn = new Map<number, number>();
    for (const squad of this.squads) {
      if (squad.state !== 'steady') continue;
      for (const s of squad.soldiers) {
        if (s.targetId === 0) continue;
        const t = this.soldierById.get(s.targetId);
        if (!t || t.hp <= 0) continue;
        const d2 = (t.x - s.x) ** 2 + (t.y - s.y) ** 2;
        if (d2 <= (MELEE_REACH * 1.6) ** 2) {
          attackersOn.set(s.targetId, (attackersOn.get(s.targetId) ?? 0) + 1);
        }
      }
    }

    for (const squad of this.squads) {
      if (squad.state !== 'steady') {
        squad.inMelee = false;
        continue;
      }
      // Same-tick contact detection: the instant any soldier is close enough to
      // an enemy, the whole squad surges NOW — no one-tick hesitation on impact.
      if (!squad.inMelee) {
        const contactRange = MELEE_REACH * 2.2;
        for (const s of squad.soldiers) {
          if (this.grid.nearestEnemy(s.x, s.y, s.team, contactRange)) {
            squad.inMelee = true;
            // Charge impact: momentum converts into bonus damage on first swings,
            // but only within the impact window — the crash, not the grind.
            if (squad.charging) {
              squad.charging = false;
              squad.chargeImpactClock = 3;
              for (const cs of squad.soldiers) cs.chargeBonus = true;
            }
            break;
          }
        }
      }
      if (squad.chargeImpactClock > 0) {
        squad.chargeImpactClock -= dt;
        if (squad.chargeImpactClock <= 0) {
          for (const cs of squad.soldiers) cs.chargeBonus = false;
        }
      }
      const type = squad.unitType;
      const surge = STANCE_SURGE[squad.stance];
      const acquireRange = squad.inMelee && surge > 0 ? surge : MELEE_ENGAGE;
      const reach = type.meleeReach;
      let contact = false;
      for (const s of squad.soldiers) {
        let target = s.targetId !== 0 ? this.soldierById.get(s.targetId) : undefined;
        if (
          !target ||
          target.hp <= 0 ||
          (target.x - s.x) ** 2 + (target.y - s.y) ** 2 > MELEE_PURSUE * MELEE_PURSUE
        ) {
          target = this.grid.nearestEnemy(s.x, s.y, s.team, acquireRange) ?? undefined;
          s.targetId = target?.id ?? 0;
          // Small stagger so contact doesn't resolve in one synchronized chop,
          // but short enough that the crash turns into fighting immediately.
          if (target) s.cooldown = this.rng.range(0.1, 0.45);
        }
        if (!target) continue;
        const d2 = (target.x - s.x) ** 2 + (target.y - s.y) ** 2;
        if (d2 <= (MELEE_REACH * 2.2) ** 2) contact = true;
        if (d2 <= reach * reach) {
          s.cooldown -= dt;
          // The impact strike lands at the gallop — no wind-up. A charge deletes
          // the men it actually hits, then the grind begins.
          if (s.chargeBonus && squad.chargeImpactClock > 0) s.cooldown = 0;
          if (s.cooldown <= 0) {
            const victimSquad = this.squadOf.get(target.id);
            const victimType = victimSquad?.unitType;
            let dmg = this.rng.int(type.meleeDamage[0], type.meleeDamage[1]);
            if (s.chargeBonus) {
              // Pikes blunt a charge — braced points meet the rush, no impact bonus.
              if (!victimType?.pike) dmg += this.rng.int(type.chargeBonus[0], type.chargeBonus[1]);
              s.chargeBonus = false;
            }
            // Pikes skewer horses.
            if (type.pike && victimType?.mounted) dmg *= 2;
            const gang = attackersOn.get(target.id) ?? 1;
            dmg *= Math.min(2.5, 1 + 0.3 * Math.max(0, gang - 1));
            if (victimSquad) {
              if (victimSquad.stance === 'defensive') dmg *= 0.9;
              else if (victimSquad.stance === 'offensive') dmg *= 1.1;
            }
            if (squad.stance === 'offensive') dmg *= 1.1;
            dmg = Math.max(1, Math.round(dmg) - (victimType?.armor ?? 0));
            target.hp -= dmg;
            s.cooldown = this.rng.range(type.meleeCooldown[0], type.meleeCooldown[1]);
          }
        }
      }
      squad.inMelee = contact;
    }
  }

  // Archers and crossbowmen loose at will when steady, out of melee, and in range.
  private rangedFire(dt: number): void {
    for (const squad of this.squads) {
      const rp = squad.unitType.ranged;
      if (!rp || squad.state !== 'steady' || squad.inMelee) continue;
      for (const s of squad.soldiers) {
        if (s.targetId !== 0) continue; // fighting for his life, not shooting
        if (s.reload === -1) {
          // Stagger the opening volley so a squad doesn't fire as one metronome.
          s.reload = this.rng.range(0.3, rp.reload[1] * 0.6);
          continue;
        }
        s.reload -= dt;
        if (s.reload > 0) continue;
        const target = this.grid.nearestEnemy(s.x, s.y, s.team, rp.range);
        if (!target) continue;
        const dist = Math.hypot(target.x - s.x, target.y - s.y);
        const flightTime = dist / rp.projectileSpeed;
        // Lead a moving target imperfectly, plus distance-scaled scatter.
        const scatter = dist * 0.05;
        const tx =
          target.x + target.vx * flightTime * 0.7 + this.rng.range(-scatter, scatter);
        const ty =
          target.y + target.vy * flightTime * 0.7 + this.rng.range(-scatter, scatter);
        this.projectiles.push({
          x: s.x,
          y: s.y,
          prevX: s.x,
          prevY: s.y,
          sx: s.x,
          sy: s.y,
          tx,
          ty,
          t: 0,
          flightTime: Math.max(0.15, flightTime),
          damage: rp.damage,
          pierce: rp.pierce,
          team: s.team,
          arcHeight: rp.arcHeight,
        });
        s.reload = this.rng.range(rp.reload[0], rp.reload[1]);
      }
    }
  }

  private tickProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.prevX = p.x;
      p.prevY = p.y;
      p.t += dt;
      const k = Math.min(1, p.t / p.flightTime);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.y = p.sy + (p.ty - p.sy) * k;
      if (k < 1) continue;

      // Landed: hit whoever stands closest to the point — friend or foe. Loosing
      // into a melee is a real gamble.
      let victim: Soldier | null = null;
      let bestD2 = PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS;
      this.grid.forEachNear(p.tx, p.ty, PROJECTILE_HIT_RADIUS, (s) => {
        if (s.hp <= 0 || s.escaped) return;
        const d2 = (s.x - p.tx) ** 2 + (s.y - p.ty) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          victim = s;
        }
      });
      if (victim !== null) {
        const v: Soldier = victim;
        const vSquad = this.squadOf.get(v.id);
        let dmg = this.rng.int(p.damage[0], p.damage[1]);
        // Charging men are exposed — no shields up, no order.
        if (vSquad?.charging) dmg *= CHARGING_MISSILE_VULNERABILITY;
        if (!p.pierce) dmg = dmg - (vSquad?.unitType.armor ?? 0);
        v.hp -= Math.max(1, Math.round(dmg));
      }
      this.projectiles.splice(i, 1);
    }
  }

  // Pairwise push-apart via the spatial grid — O(n · neighbors), fine at 1000v1000.
  private separateSoldiers(): void {
    for (const a of this.allSoldiers) {
      this.grid.forEachNear(a.x, a.y, a.radius * 2 + 6, (b) => {
        if (b.id <= a.id) return; // each pair once
        const minDist = a.radius + b.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) return;
        const d = Math.sqrt(d2);
        const push = (minDist - d) / 2;
        const px = (dx / d) * push;
        const py = (dy / d) * push;
        a.x -= px;
        a.y -= py;
        b.x += px;
        b.y += py;
      });
    }
  }

  // Hard guarantees after all steering: nobody inside a rock; only FLEEING
  // soldiers may run off the edge (and are removed once fully out) — routed
  // squads stay on the field, since they might rally.
  private resolveObstaclesAndBounds(): void {
    const world = this.world;
    for (const squad of this.squads) {
      const mayLeave = squad.state === 'fleeing';
      for (const s of squad.soldiers) {
        for (const o of world.obstacles) {
          if (o.kind !== 'rock') continue;
          const dx = s.x - o.x;
          const dy = s.y - o.y;
          const min = o.radius + s.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          s.x = o.x + (dx / d) * min;
          s.y = o.y + (dy / d) * min;
        }
        if (mayLeave) {
          if (
            s.x < -40 ||
            s.x > world.widthPx + 40 ||
            s.y < -40 ||
            s.y > world.heightPx + 40
          ) {
            s.escaped = true;
          }
        } else {
          s.x = Math.min(world.widthPx - SOLDIER_RADIUS, Math.max(SOLDIER_RADIUS, s.x));
          s.y = Math.min(world.heightPx - SOLDIER_RADIUS, Math.max(SOLDIER_RADIUS, s.y));
        }
      }
    }
  }

  private cullDead(): void {
    let removedAny = false;
    for (const squad of this.squads) {
      const removed = squad.removeDead();
      for (const s of removed) {
        removedAny = true;
        this.soldierById.delete(s.id);
        this.squadOf.delete(s.id);
        this.pendingDeaths.push({ id: s.id, x: s.x, y: s.y, team: s.team, escaped: s.escaped });
      }
    }
    if (removedAny) {
      this.allSoldiers = this.allSoldiers.filter((s) => s.hp > 0 && !s.escaped);
    }
  }
}
