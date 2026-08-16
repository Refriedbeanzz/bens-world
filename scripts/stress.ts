// Headless stress test: 500v500 melee with everyone ordered to charge.
// Run: npm run stress
// Budget: a sim tick must stay well under 33ms (30 ticks/sec).
import { Battle, type SquadSpec } from '../src/sim/battle';

const setup: SquadSpec[] = [];
for (let i = 0; i < 10; i++) {
  setup.push({ team: 0, count: 50, x: 0.15, y: 0.08 + i * 0.09, facing: 0, formation: 'line' });
  setup.push({ team: 1, count: 50, x: 0.85, y: 0.08 + i * 0.09, facing: Math.PI, formation: 'line' });
}

const battle = new Battle(20260816, setup);
const total = battle.squads.reduce((n, s) => n + s.soldiers.length, 0);
console.log(`soldiers: ${total}`);

for (const squad of battle.squads) {
  const tx = squad.team === 0 ? battle.world.widthPx * 0.85 : battle.world.widthPx * 0.15;
  squad.orderMove(tx, squad.anchorY, battle.world);
}

const DT = 1 / 30;
const TICKS = 3600; // 2 minutes of battle
let worst = 0;
const t0 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const a = performance.now();
  battle.tick(DT);
  const cost = performance.now() - a;
  if (cost > worst) worst = cost;
  if (i % 600 === 0) {
    const alive0 = battle.squads.filter((s) => s.team === 0).reduce((n, s) => n + s.soldiers.length, 0);
    const alive1 = battle.squads.filter((s) => s.team === 1).reduce((n, s) => n + s.soldiers.length, 0);
    console.log(`t=${(i / 30).toFixed(0)}s blue=${alive0} red=${alive1} tick=${cost.toFixed(2)}ms`);
  }
  battle.consumeDeaths();
}
const elapsed = performance.now() - t0;
console.log(`avg tick: ${(elapsed / TICKS).toFixed(3)}ms  worst: ${worst.toFixed(2)}ms  (budget: 33ms)`);
const alive0 = battle.squads.filter((s) => s.team === 0).reduce((n, s) => n + s.soldiers.length, 0);
const alive1 = battle.squads.filter((s) => s.team === 1).reduce((n, s) => n + s.soldiers.length, 0);
console.log(`final: blue=${alive0} red=${alive1}`);
