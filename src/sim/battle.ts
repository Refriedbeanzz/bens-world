import { Rng } from './rng';
import { SpatialGrid } from './spatialgrid';
import { Squad } from './squad';
import { MELEE_ENGAGE, MELEE_KEEP, MELEE_REACH, SOLDIER_RADIUS, type Soldier } from './soldier';
import { World } from './world';

export const PLAYER_TEAM = 0;

const AI_THINK_INTERVAL = 2; // seconds between enemy decisions
const AI_AGGRO_RANGE = 550;

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

  constructor(seed: number, setup: SquadSpec[] = DEFAULT_SETUP) {
    this.world = new World(seed);
    this.rng = new Rng(seed ^ 0x5eed);
    this.grid = new SpatialGrid(this.world.widthPx, this.world.heightPx);

    for (const spec of setup) {
      this.squads.push(
        new Squad(
          spec.team,
          spec.count,
          this.world.widthPx * spec.x,
          this.world.heightPx * spec.y,
          spec.facing,
          spec.formation,
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
    const hitRadius = SOLDIER_RADIUS * 2.5;
    for (const squad of this.squads) {
      if (squad.team !== PLAYER_TEAM) continue;
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
      if (best) squad.orderMove(best.anchorX, best.anchorY, this.world);
    }
  }

  // Melee: acquire the nearest enemy in ENGAGE range, chase within KEEP, swing at REACH.
  private combat(dt: number): void {
    for (const squad of this.squads) {
      if (squad.state === 'routing') continue;
      for (const s of squad.soldiers) {
        let target = s.targetId !== 0 ? this.soldierById.get(s.targetId) : undefined;
        if (
          !target ||
          target.hp <= 0 ||
          (target.x - s.x) ** 2 + (target.y - s.y) ** 2 > MELEE_KEEP * MELEE_KEEP
        ) {
          target = this.grid.nearestEnemy(s.x, s.y, s.team, MELEE_ENGAGE) ?? undefined;
          s.targetId = target?.id ?? 0;
          // Stagger the first swing so contact doesn't resolve in one synchronized chop.
          if (target) s.cooldown = this.rng.range(0.25, 0.7);
        }
        if (!target) continue;
        const d2 = (target.x - s.x) ** 2 + (target.y - s.y) ** 2;
        if (d2 <= MELEE_REACH * MELEE_REACH) {
          s.cooldown -= dt;
          if (s.cooldown <= 0) {
            target.hp -= this.rng.int(22, 34);
            s.cooldown = this.rng.range(1.0, 1.6);
          }
        }
      }
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

  // Hard guarantees after all steering: nobody inside a rock; steady soldiers stay
  // on the map, routed ones may run off the edge and are removed once fully out.
  private resolveObstaclesAndBounds(): void {
    const world = this.world;
    for (const squad of this.squads) {
      const routing = squad.state === 'routing';
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
        if (routing) {
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
