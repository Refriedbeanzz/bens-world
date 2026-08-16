import { Squad } from './squad';
import { SOLDIER_RADIUS } from './soldier';
import { World } from './world';

export const PLAYER_TEAM = 0;

// The whole battle state: world + squads. One tick() advances everything.
export class Battle {
  readonly world: World;
  readonly squads: Squad[] = [];

  constructor(seed: number) {
    this.world = new World(seed);

    this.squads.push(
      new Squad(PLAYER_TEAM, 50, this.world.widthPx * 0.22, this.world.heightPx * 0.38, 0, 'line'),
      new Squad(PLAYER_TEAM, 50, this.world.widthPx * 0.22, this.world.heightPx * 0.62, 0, 'line'),
      new Squad(1, 50, this.world.widthPx * 0.78, this.world.heightPx * 0.5, Math.PI, 'square'),
    );
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
  }
}
