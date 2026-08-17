import { Rng } from './rng';
import { SpatialGrid } from './spatialgrid';
import { Squad } from './squad';
import {
  MELEE_ENGAGE,
  MELEE_PURSUE,
  MELEE_REACH,
  MELEE_SURGE,
  SOLDIER_RADIUS,
  type Soldier,
} from './soldier';
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
  formation: 'line' | 'column' | 'wedge' | 'square' | 'wall' | 'loose';
}

const DEFAULT_SETUP: SquadSpec[] = [
  { team: 0, count: 50, x: 0.22, y: 0.38, facing: 0, formation: 'line' },
  { team: 0, count: 50, x: 0.22, y: 0.62, facing: 0, formation: 'line' },
  { team: 1, count: 50, x: 0.78, y: 0.38, facing: Math.PI, formation: 'line' },
  { team: 1, count: 50, x: 0.78, y: 0.62, facing: Math.PI, formation: 'line' },
];

// The whole battle state: world + squads. One tick() advances everything.
export class Battle {
  readonly world: World;
  readonly squads: Squad[] = [];
  private allSoldiers: Soldier[] = [];
  private readonly soldierById = new Map<number, Soldier>();
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
    this.separateSoldiers();
    this.resolveObstaclesAndBounds();
    this.cullDead();
    this.rallyRoutedSquads(dt);
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
      if (best && !squad.isAttacking(best)) squad.orderAttack(best, this.world);
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
            // Charge impact: momentum converts into bonus damage on first swings.
            if (squad.charging) {
              squad.charging = false;
              for (const cs of squad.soldiers) cs.chargeBonus = true;
            }
            break;
          }
        }
      }
      const acquireRange = squad.inMelee ? MELEE_SURGE : MELEE_ENGAGE;
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
        if (d2 <= MELEE_REACH * MELEE_REACH) {
          s.cooldown -= dt;
          if (s.cooldown <= 0) {
            let dmg = this.rng.int(7, 11);
            if (s.chargeBonus) {
              dmg += this.rng.int(12, 18);
              s.chargeBonus = false;
            }
            const gang = attackersOn.get(target.id) ?? 1;
            dmg = Math.round(dmg * Math.min(2.5, 1 + 0.3 * Math.max(0, gang - 1)));
            target.hp -= dmg;
            s.cooldown = this.rng.range(1.4, 2.0);
          }
        }
      }
      squad.inMelee = contact;
    }
  }

  // Pairwise push-apart via the spatial grid — O(n · neighbors), fine at 1000v1000.
  private separateSoldiers(): void {
    const minDist = SOLDIER_RADIUS * 2;
    for (const a of this.allSoldiers) {
      this.grid.forEachNear(a.x, a.y, minDist, (b) => {
        if (b.id <= a.id) return; // each pair once
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
          const min = o.radius + SOLDIER_RADIUS;
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
        this.pendingDeaths.push({ id: s.id, x: s.x, y: s.y, team: s.team, escaped: s.escaped });
      }
    }
    if (removedAny) {
      this.allSoldiers = this.allSoldiers.filter((s) => s.hp > 0 && !s.escaped);
    }
  }
}
