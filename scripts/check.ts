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
  const startTotal = count(battle, 0) + count(battle, 1);
  for (const squad of battle.squads) {
    const enemy = battle.squads.find((o) => o.team !== squad.team && o.soldiers.length > 0);
    if (enemy) squad.orderAttack(enemy, battle.world);
  }
  run(battle, 'S1', 120);
  assert(count(battle, 0) + count(battle, 1) < startTotal, 'S1: no casualties after 120s of battle');
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

// S3: hopeless fight — the small squad must shatter, FLEE, and leave the map.
console.log('S3: shatter and flee');
{
  const battle = new Battle(4242, [
    { team: 0, count: 50, x: 0.45, y: 0.5, facing: 0, formation: 'line' },
    { team: 1, count: 50, x: 0.55, y: 0.4, facing: Math.PI, formation: 'line' },
    { team: 1, count: 50, x: 0.55, y: 0.5, facing: Math.PI, formation: 'line' },
    { team: 1, count: 50, x: 0.55, y: 0.6, facing: Math.PI, formation: 'line' },
    { team: 1, count: 50, x: 0.62, y: 0.5, facing: Math.PI, formation: 'line' },
  ], { enemyAI: false });
  const blue = battle.squads[0]!;
  blue.orderAttack(battle.squads[1]!, battle.world);
  let sawEscape = false;
  let sawFleeing = false;
  const ticks = Math.round(240 * 30);
  for (let i = 0; i < ticks; i++) {
    battle.tick(DT);
    for (const d of battle.consumeDeaths()) if (d.escaped) sawEscape = true;
    if (blue.state === 'fleeing') sawFleeing = true;
    // Red commander gives no quarter: attack while blue stands (including after
    // a rally), chase its position while it runs (attack orders drop routed targets).
    if (i % 60 === 0 && blue.soldiers.length > 0) {
      const bs = blue.soldiers[0]!;
      for (const red of battle.squads) {
        if (red.team !== 1 || red.state !== 'steady') continue;
        if (blue.state === 'steady') {
          if (!red.isAttacking(blue)) red.orderAttack(blue, battle.world);
        } else {
          red.orderMove(bs.x, bs.y, battle.world);
        }
      }
    }
    if (i % 30 === 0) checkInvariants(battle, 'S3', i);
    if (blue.soldiers.length === 0) break;
  }
  assert(sawFleeing, 'S3: hopeless squad never shattered into fleeing');
  assert(sawEscape || blue.soldiers.length === 0, 'S3: fleeing soldiers never escaped the map');
}

// S6: rout then rally — a broken squad given breathing room must regroup as steady.
console.log('S6: rout and rally');
{
  const battle = new Battle(1357, [
    { team: 0, count: 50, x: 0.35, y: 0.5, facing: 0, formation: 'line' },
    { team: 1, count: 50, x: 0.5, y: 0.45, facing: Math.PI, formation: 'line' },
    { team: 1, count: 50, x: 0.5, y: 0.55, facing: Math.PI, formation: 'line' },
  ], { enemyAI: false });
  const blue = battle.squads[0]!;
  blue.orderAttack(battle.squads[1]!, battle.world);
  let broke = false;
  const ticks = Math.round(180 * 30);
  for (let i = 0; i < ticks; i++) {
    battle.tick(DT);
    battle.consumeDeaths();
    if (blue.state === 'routing') broke = true;
    // The moment blue breaks, pull the red squads far away so it can rally.
    if (broke && i % 60 === 0 && blue.state === 'routing') {
      for (const red of battle.squads) {
        if (red.team === 1) {
          red.orderMove(battle.world.widthPx * 0.95, battle.world.heightPx * 0.1, battle.world);
        }
      }
    }
    if (i % 30 === 0) checkInvariants(battle, 'S6', i);
    if (broke && blue.state === 'steady') break;
  }
  assert(broke, 'S6: squad never routed');
  assert(blue.state === 'steady' && blue.rallied, 'S6: routed squad never rallied');
  assert(blue.soldiers.length > 0, 'S6: rallied squad has no men');
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

// S7: archery — arrows must kill at range before contact ever happens.
console.log('S7: archers kill at range');
{
  const battle = new Battle(31415, [
    { team: 0, count: 40, x: 0.38, y: 0.5, facing: 0, formation: 'loose', type: 'archer' },
    { team: 1, count: 40, x: 0.5, y: 0.5, facing: Math.PI, formation: 'line', type: 'swordsman' },
  ], { enemyAI: false });
  const red = battle.squads[1]!;
  // Hold red still: keep re-issuing a stand-fast move order at its own anchor.
  const [rx, ry] = [red.anchorX, red.anchorY];
  let casualtiesBeforeContact = 0;
  for (let i = 0; i < 45 * 30; i++) {
    if (i % 60 === 0) red.orderMove(rx, ry, battle.world);
    battle.tick(DT);
    battle.consumeDeaths();
    if (!red.inMelee) casualtiesBeforeContact = 40 - red.soldiers.length;
    if (i % 30 === 0) checkInvariants(battle, 'S7', i);
  }
  assert(casualtiesBeforeContact > 0, 'S7: arrows caused no casualties at range');
}

// S8: pikes vs cavalry — a knight charge into a pike wall must go badly for the knights.
console.log('S8: pikes blunt a cavalry charge');
{
  const battle = new Battle(27182, [
    { team: 0, count: 50, x: 0.45, y: 0.5, facing: 0, formation: 'wall', type: 'pikeman' },
    { team: 1, count: 20, x: 0.6, y: 0.5, facing: Math.PI, formation: 'wedge', type: 'knight' },
  ], { enemyAI: false });
  const pikes = battle.squads[0]!;
  const knights = battle.squads[1]!;
  knights.orderAttack(pikes, battle.world);
  knights.startCharge();
  for (let i = 0; i < 120 * 30; i++) {
    battle.tick(DT);
    battle.consumeDeaths();
    if (i % 30 === 0) checkInvariants(battle, 'S8', i);
    if (knights.state !== 'steady' || knights.soldiers.length === 0) break;
  }
  assert(
    knights.state !== 'steady' || knights.soldiers.length === 0,
    `S8: knights were not broken by the pike wall (knights ${knights.soldiers.length}, pikes ${pikes.soldiers.length})`,
  );
  assert(pikes.state === 'steady', `S8: pike wall broke (pikes ${pikes.soldiers.length} left)`);
}

// S9: the AI commander must decisively beat an identical army with no orders.
console.log('S9: AI commander beats an idle army');
{
  const battle = new Battle(20260816); // default mixed-arms 4v4, AI on
  const start0 = count(battle, 0);
  const fighting = (team: number) =>
    battle.squads
      .filter((s) => s.team === team && s.state === 'steady')
      .reduce((n, s) => n + s.soldiers.length, 0);
  for (let i = 0; i < 300 * 30; i++) {
    battle.tick(DT);
    battle.consumeDeaths();
    if (i % 60 === 0) checkInvariants(battle, 'S9', i);
    if (fighting(0) === 0) break;
  }
  const playerLosses = 1 - count(battle, 0) / start0;
  assert(
    fighting(0) === 0 || fighting(1) > fighting(0) * 1.5,
    `S9: AI failed to beat an idle army (blue ${fighting(0)} vs red ${fighting(1)})`,
  );
  assert(playerLosses > 0.4, `S9: AI barely scratched the idle army (${Math.round(playerLosses * 100)}% losses)`);
}

if (failures === 0) {
  console.log('ALL CHECKS PASSED');
} else {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
