import { Squad } from './squad';
import { World } from './world';

// The whole battle state: world + squads. One tick() advances everything.
export class Battle {
  readonly world: World;
  readonly squads: Squad[] = [];
  readonly playerSquad: Squad;

  constructor(seed: number) {
    this.world = new World(seed);

    this.playerSquad = new Squad(
      0,
      50,
      this.world.widthPx * 0.22,
      this.world.heightPx * 0.5,
      0,
      'line',
    );
    const enemy = new Squad(
      1,
      50,
      this.world.widthPx * 0.78,
      this.world.heightPx * 0.5,
      Math.PI,
      'square',
    );
    this.squads.push(this.playerSquad, enemy);
  }

  tick(dt: number): void {
    for (const squad of this.squads) squad.tick(dt, this.world);
  }
}
