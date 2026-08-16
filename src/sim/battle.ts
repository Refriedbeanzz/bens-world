import { Squad } from './squad';
import { SOLDIER_RADIUS, type Soldier } from './soldier';
import { World } from './world';

export const PLAYER_TEAM = 0;

// The whole battle state: world + squads. One tick() advances everything.
export class Battle {
  readonly world: World;
  readonly squads: Squad[] = [];
  private readonly allSoldiers: Soldier[] = [];

  constructor(seed: number) {
    this.world = new World(seed);

    this.squads.push(
      new Squad(PLAYER_TEAM, 50, this.world.widthPx * 0.22, this.world.heightPx * 0.38, 0, 'line'),
      new Squad(PLAYER_TEAM, 50, this.world.widthPx * 0.22, this.world.heightPx * 0.62, 0, 'line'),
      new Squad(1, 50, this.world.widthPx * 0.78, this.world.heightPx * 0.5, Math.PI, 'square'),
    );
    for (const squad of this.squads) this.allSoldiers.push(...squad.soldiers);
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

  tick(dt: number): void {
    for (const squad of this.squads) squad.tick(dt, this.world);
    this.separateSoldiers();
    this.resolveObstaclesAndBounds();
  }

  // Pairwise push-apart across ALL soldiers (any squad) so bodies never stack.
  private separateSoldiers(): void {
    const minDist = SOLDIER_RADIUS * 2;
    const soldiers = this.allSoldiers;
    const n = soldiers.length;
    for (let i = 0; i < n; i++) {
      const a = soldiers[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = soldiers[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (minDist - d) / 2;
        const px = (dx / d) * push;
        const py = (dy / d) * push;
        a.x -= px;
        a.y -= py;
        b.x += px;
        b.y += py;
      }
    }
  }

  // Hard guarantees after all steering: nobody inside a rock, nobody off the map.
  // Trees are soft — soldiers may pass under the canopy, just slowed.
  private resolveObstaclesAndBounds(): void {
    const world = this.world;
    for (const s of this.allSoldiers) {
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
      s.x = Math.min(world.widthPx - SOLDIER_RADIUS, Math.max(SOLDIER_RADIUS, s.x));
      s.y = Math.min(world.heightPx - SOLDIER_RADIUS, Math.max(SOLDIER_RADIUS, s.y));
    }
  }
}
