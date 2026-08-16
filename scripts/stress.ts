// Headless stress test: full melee charge at a chosen size.
// Run: npm run stress            (500 per side)
//      npm run stress -- 100     (100 per side)
// Budget: a sim tick must stay well under 33ms (30 ticks/sec).
import { Battle, type SquadSpec } from '../src/sim/battle';

const perSide = Number(process.argv[2] ?? 500);
const squadsPerSide = Math.max(1, Math.round(perSide / 50));

const setup: SquadSpec[] = [];
for (let i = 0; i < squadsPerSide; i++) {
  const y = squadsPerSide === 1 ? 0.5 : 0.08 + (i * 0.84) / (squadsPerSide - 1);
  setup.push({ team: 0, count: 50, x: 0.15, y, facing: 0, formation: 'line' });
  setup.push({ team: 1, count: 50, x: 0.85, y, facing: Math.PI, formation: 'line' });
}

const battle = new Battle(20260816, setup);
const total = battle.squads.reduce((n, s) => n + s.soldiers.length, 0);
console.log(`soldiers: ${total}`);

// Both sides fight to the finish: any idle steady squad attacks the nearest
// steady enemy squad (re-issued periodically, like a player would).
function reengage(): void {
  for (const squad of battle.squads) {
    if (squad.state !== 'steady' || squad.soldiers.length === 0 || squad.isAttacking()) continue;
    let best = null as (typeof battle.squads)[number] | null;
    let bestD2 = Infinity;
    for (const other of battle.squads) {
      if (other.team === squad.team || other.state !== 'steady' || other.soldiers.length === 0) continue;
      const d2 = (other.anchorX - squad.anchorX) ** 2 + (other.anchorY - squad.anchorY) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = other;
      }
    }
    if (best) squad.orderAttack(best, battle.world);
  }
}
reengage();

const DT = 1 / 30;
const TICKS = 18000; // up to 10 minutes of battle
const fighting = (team: number) =>
  battle.squads
    .filter((s) => s.team === team && s.state === 'steady')
    .reduce((n, s) => n + s.soldiers.length, 0);

let worst = 0;
let contactAt = -1;
let decidedAt = -1;
const t0 = performance.now();
let i = 0;
for (; i < TICKS; i++) {
  const a = performance.now();
  battle.tick(DT);
  const cost = performance.now() - a;
  if (cost > worst) worst = cost;
  if (i % 60 === 0) reengage();
  if (contactAt < 0 && battle.squads.some((s) => s.inMelee)) contactAt = i / 30;
  if (decidedAt < 0 && (fighting(0) === 0 || fighting(1) === 0)) {
    decidedAt = i / 30;
    break;
  }
  if (i % 600 === 0) {
    const alive0 = battle.squads.filter((s) => s.team === 0).reduce((n, s) => n + s.soldiers.length, 0);
    const alive1 = battle.squads.filter((s) => s.team === 1).reduce((n, s) => n + s.soldiers.length, 0);
    console.log(`t=${(i / 30).toFixed(0)}s blue=${alive0} red=${alive1} tick=${cost.toFixed(2)}ms`);
  }
  battle.consumeDeaths();
}
if (contactAt >= 0 && decidedAt >= 0) {
  console.log(
    `contact at ${contactAt.toFixed(1)}s, decided at ${decidedAt.toFixed(1)}s -> fight length ${(decidedAt - contactAt).toFixed(1)}s`,
  );
}
const elapsed = performance.now() - t0;
console.log(`avg tick: ${(elapsed / TICKS).toFixed(3)}ms  worst: ${worst.toFixed(2)}ms  (budget: 33ms)`);
const alive0 = battle.squads.filter((s) => s.team === 0).reduce((n, s) => n + s.soldiers.length, 0);
const alive1 = battle.squads.filter((s) => s.team === 1).reduce((n, s) => n + s.soldiers.length, 0);
console.log(`final: blue=${alive0} red=${alive1}`);
