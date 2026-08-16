// Headless verification suite. Run: npm run check
// Exercises the sim end to end and asserts invariants that must always hold.
import { Battle } from '../src/sim/battle';
import type { FormationKind } from '../src/sim/formation';
import { SOLDIER_RADIUS } from '../src/sim/soldier';

const DT = 1 / 30;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}

function checkInvariants(battle: Battle, label: string, tick: number): void {
  const ids = new Set<number>();
  for (const squad of battle.squads) {
    const slots = new Set<number>();
    for (const s of squad.soldiers) {
      const at = `${label} t=${(tick / 30).toFixed(1)}s soldier ${s.id}`;
      assert(Number.isFinite(s.x) && Number.isFinite(s.y), `${at}: position is NaN/Infinity`);
      assert(Number.isFinite(s.vx) && Number.isFinite(s.vy), `${at}: velocity is NaN/Infinity`);
      assert(s.hp > 0, `${at}: dead soldier still in squad`);
      assert(!ids.has(s.id), `${at}: duplicate soldier id`);
      ids.add(s.id);
      assert(!slots.has(s.slot), `${at}: duplicate slot assignment`);
      slots.add(s.slot);
      if (squad.state === 'steady') {
        assert(
          s.x >= 0 && s.x <= battle.world.widthPx && s.y >= 0 && s.y <= battle.world.heightPx,
          `${at}: steady soldier off the map (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`,
        );
      }
      for (const o of battle.world.obstacles) {
        if (o.kind !== 'rock') continue;
        const d = Math.hypot(s.x - o.x, s.y - o.y);
        assert(d >= o.radius + SOLDIER_RADIUS - 1.5, `${at}: inside a rock (overlap ${(o.radius + SOLDIER_RADIUS - d).toFixed(1)}px)`);
      }
    }
  }
}

function run(battle: Battle, label: string, seconds: number, each?: (tick: number) => void): void {
  const ticks = Math.round(seconds * 30);
  for (let i = 0; i < ticks; i++) {
    battle.tick(DT);
    each?.(i);
    if (i % 30 === 0) checkInvariants(battle, label, i);
    battle.consumeDeaths();
  }
  checkInvariants(battle, label, ticks);
}

function count(battle: Battle, team: number): number {
  return battle.squads.filter((s) => s.team === team).reduce((n, s) => n + s.soldiers.length, 0);
}

// S1: meeting engagement — everyone charges, battle must produce casualties and stay sane.
console.log('S1: 2v2 meeting engagement');
{
  const battle = new Battle(20260816);
  for (const squad of battle.squads) {
    const enemy = battle.squads.find((o) => o.team !== squad.team && o.soldiers.length > 0);
    if (enemy) squad.orderAttack(enemy, battle.world);
  }
  run(battle, 'S1', 120);
  assert(count(battle, 0) + count(battle, 1) < 200, 'S1: no casualties after 120s of battle');
}

// S2: formation cycling while marching — slots must stay consistent through every change.
console.log('S2: formation cycling on the move');
{
  const battle = new Battle(777, [
    { team: 0, count: 50, x: 0.15, y: 0.5, facing: 0, formation: 'line' },
  ]);
  const squad = battle.squads[0]!;
  const kinds: FormationKind[] = ['line', 'column', 'wedge', 'square', 'wall', 'loose'];
  let k = 0;
  squad.orderMove(battle.world.widthPx * 0.85, battle.world.heightPx * 0.5, battle.world);
  run(battle, 'S2', 90, (tick) => {
    if (tick % 90 === 0) squad.setFormation(kinds[k++ % kinds.length]!);
    if (tick % 300 === 0) {
      // Bounce between the map's ends so it keeps marching (and wheeling) the whole time.
      const goRight = squad.anchorX < battle.world.widthPx / 2;
      squad.orderMove(battle.world.widthPx * (goRight ? 0.85 : 0.15), battle.world.heightPx * 0.5, battle.world);
    }
  });
  assert(squad.soldiers.length === 50, 'S2: soldiers lost without combat');
  // Cohesion: wait for the march to actually finish (momentum!), then everyone near a slot.
  let stillFor = 0;
  for (let i = 0; i < 90 * 30 && stillFor < 90; i++) {
    battle.tick(DT);
    stillFor = squad.speed === 0 ? stillFor + 1 : 0;
  }
  assert(stillFor >= 90, 'S2: squad never came to rest');
  let worst = 0;
  for (const s of squad.soldiers) {
    const [sx, sy] = squad.slotWorld(s.slot);
    worst = Math.max(worst, Math.hypot(s.x - sx, s.y - sy));
  }
  assert(worst < 60, `S2: formation failed to reassemble (straggler ${worst.toFixed(0)}px from slot)`);
}

// S3: lopsided fight — the small squad must break, flee, and drain off the map.
console.log('S3: rout and escape');
{
  const battle = new Battle(4242, [
    { team: 0, count: 50, x: 0.45, y: 0.5, facing: 0, formation: 'line' },
    { team: 1, count: 50, x: 0.55, y: 0.45, facing: Math.PI, formation: 'line' },
    { team: 1, count: 50, x: 0.55, y: 0.55, facing: Math.PI, formation: 'line' },
  ]);
  const blue = battle.squads[0]!;
  blue.orderAttack(battle.squads[1]!, battle.world);
  let sawEscape = false;
  const ticks = Math.round(240 * 30);
  for (let i = 0; i < ticks; i++) {
    battle.tick(DT);
    for (const d of battle.consumeDeaths()) if (d.escaped) sawEscape = true;
    if (i % 30 === 0) checkInvariants(battle, 'S3', i);
    if (blue.soldiers.length === 0) break;
  }
  assert(blue.state === 'routing' || blue.soldiers.length === 0, 'S3: outnumbered squad never broke');
  assert(sawEscape || blue.soldiers.length === 0, 'S3: routed soldiers never escaped the map');
}

// S4: determinism — two identical runs must produce byte-identical battles.
console.log('S4: determinism');
{
  const snapshot = (): number[] => {
    const battle = new Battle(20260816);
    for (const squad of battle.squads) {
      const enemy = battle.squads.find((o) => o.team !== squad.team);
      if (enemy) squad.orderAttack(enemy, battle.world);
    }
    for (let i = 0; i < 90 * 30; i++) {
      battle.tick(DT);
      battle.consumeDeaths();
    }
    const out: number[] = [];
    for (const squad of battle.squads) {
      for (const s of squad.soldiers) out.push(s.id, s.x, s.y, s.hp);
    }
    return out;
  };
  const a = snapshot();
  const b = snapshot();
  assert(a.length === b.length, `S4: run lengths differ (${a.length} vs ${b.length})`);
  let diverged = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      diverged = i;
      break;
    }
  }
  assert(diverged === -1, `S4: runs diverged at value index ${diverged}`);
}

// S5: forest march — cross the whole map through trees and reassemble.
console.log('S5: forest march');
{
  const battle = new Battle(998877, [
    { team: 0, count: 50, x: 0.08, y: 0.3, facing: 0, formation: 'column' },
  ]);
  const squad = battle.squads[0]!;
  const tx = battle.world.widthPx * 0.92;
  const ty = battle.world.heightPx * 0.7;
  squad.orderMove(tx, ty, battle.world);
  run(battle, 'S5', 150);
  assert(
    Math.hypot(squad.anchorX - tx, squad.anchorY - ty) < 40,
    `S5: squad never arrived (anchor ${Math.hypot(squad.anchorX - tx, squad.anchorY - ty).toFixed(0)}px away)`,
  );
  let worst = 0;
  for (const s of squad.soldiers) {
    const [sx, sy] = squad.slotWorld(s.slot);
    worst = Math.max(worst, Math.hypot(s.x - sx, s.y - sy));
  }
  assert(worst < 60, `S5: stragglers left behind (worst ${worst.toFixed(0)}px from slot)`);
}

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
