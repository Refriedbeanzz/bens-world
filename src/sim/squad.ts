import { FlowField } from './flowfield';
import {
  FORMATION_CURVES,
  FORMATION_JITTER,
  FORMATION_SPEED,
  layoutSlots,
  WIDTH_FORMATIONS,
  type FormationKind,
  type Slot,
} from './formation';
import {
  MELEE_PURSUE,
  SOLDIER_ACCEL,
  SOLDIER_MAX_SPEED,
  SOLDIER_RADIUS,
  type Soldier,
} from './soldier';
import { UNIT_TYPES, type UnitKey, type UnitType } from './unittype';
import { CELL, type World } from './world';

const MARCH_SPEED = 42; // how fast the formation anchor slides, px/s
const TURN_RATE = 1.1; // rad/s — slow, stately wheeling; fast turns scrambled the ranks
const ARRIVE_RADIUS = 5;
// Momentum: a formation is a mass of men. ~2.3s to reach march speed, and it
// brakes early enough to stop on the ordered point. Charging builds on this.
const MARCH_ACCEL = 18; // px/s²
const MARCH_DECEL = 32; // px/s²
const AVOID_LOOKAHEAD = 70; // how far ahead a soldier scans for an obstacle in his way
// Morale: at ROUT losses a squad breaks and runs, but can rally and rejoin the
// fight. At SHATTER losses — or breaking a second time — it flees the battle
// for good.
const ROUT_CASUALTY_FRACTION = 0.4;
const SHATTER_CASUALTY_FRACTION = 0.7;
// Charging: much faster, hits harder on impact — and (later) more vulnerable to
// arrows and formation counters like braced pikes. Read `charging` for those.
const CHARGE_SPEED_MULT = 1.8;
const CHARGE_ACCEL_MULT = 1.7;
const CHARGE_SOLDIER_SPEED_MULT = 1.6;
// Stances: how far men range from the formation to fight. Defensive squads hold
// their ranks; offensive squads hunt. Some formations imply a stance by default.
export type Stance = 'defensive' | 'balanced' | 'offensive';
export const STANCE_LEASH: Record<Stance, number> = { defensive: 100, balanced: 170, offensive: 240 };
export const STANCE_SURGE: Record<Stance, number> = { defensive: 0, balanced: 160, offensive: 210 };
const DEFAULT_STANCE: Partial<Record<FormationKind, Stance>> = {
  wall: 'defensive',
  circle: 'defensive',
  wedge: 'offensive',
};
// In-combat footwork: a man trading blows shuffles, he doesn't sprint. Surging
// toward a fight is quicker but still slower than open-field running.
const FIGHTING_SPEED_MULT = 0.35;
const SURGE_SPEED_MULT = 0.75;
// Curved wheeling: each slot's facing chases the squad facing, and slots far
// from the center chase slower — so a turning line bows through the wheel and
// dresses straight afterward. Rigid formations (wall/column/square) skip this.
const SLOT_TURN_BASE = 2.4; // rad/s for a slot at the anchor
const SLOT_TURN_FALLOFF = 55; // px of offset that halves the turn speed

export type SquadState = 'steady' | 'routing' | 'fleeing';
export type SoldierLookup = (id: number) => Soldier | undefined;

// Deterministic per-soldier randomness derived from the id — no RNG calls, so
// battle replay determinism is untouched.
function hash01(n: number, salt: number): number {
  let t = (Math.imul(n, 374761393) + Math.imul(salt, 668265263)) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

// True when the straight segment crosses nothing but open ground. Forest counts as
// "not clear" — not because it's impassable, but so the decision to cut through vs
// go around is made by the cost-aware flow field, never by beelining.
function losClear(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / (CELL / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor((x0 + dx * t) / CELL);
    const cy = Math.floor((y0 + dy * t) / CELL);
    if (!world.isOpen(cx, cy)) return false;
  }
  return true;
}

/** True when the straight segment crosses no hard wall (rocks). Trees don't count — they're walkable. */
function losPassable(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / (CELL / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor((x0 + dx * t) / CELL);
    const cy = Math.floor((y0 + dy * t) / CELL);
    if (world.isBlocked(cx, cy)) return false;
  }
  return true;
}

export class Squad {
  readonly team: number;
  readonly unitType: UnitType;
  readonly soldiers: Soldier[] = [];
  formation: FormationKind;
  stance: Stance = 'balanced';
  state: SquadState = 'steady';
  // True while the squad is in melee contact — set by the battle's combat pass.
  // Unengaged soldiers of an in-melee squad surge in instead of holding slots.
  inMelee = false;
  // True from the charge order until impact or arrival.
  charging = false;
  // Seconds left in the impact window: charge-bonus swings only land this long
  // after the crash, so a charge kills the men it HIT, not someone 20s later.
  chargeImpactClock = 0;
  // A squad that has rallied once flees for good the next time it breaks.
  rallied = false;
  // Seconds of breathing room accumulated while routing; battle drives this.
  rallyProgress = 0;
  anchorX: number;
  anchorY: number;
  facing: number;
  // Current formation speed, px/s — ramps up and down with momentum.
  speed = 0;
  // Frontage override (files across) from a dragged battle line; null = formation default.
  widthCols: number | null = null;
  // Direction to front toward once the move completes (from a dragged battle line).
  arrivalFacing: number | null = null;
  private readonly initialCount: number;
  private slots: Slot[];
  private orderX: number | null = null;
  private orderY: number | null = null;
  private flow: FlowField | null = null;
  private flowTargetX = 0;
  private flowTargetY = 0;
  private attackTarget: Squad | null = null;
  // Flank order: attack this squad automatically once the move waypoint is reached.
  private pendingAttack: Squad | null = null;

  constructor(
    team: number,
    unit: UnitKey,
    count: number,
    x: number,
    y: number,
    facing: number,
    formation: FormationKind,
    // Battle-owned id allocator: module-global ids broke run-to-run determinism.
    allocId: () => number,
  ) {
    this.team = team;
    this.unitType = UNIT_TYPES[unit];
    this.formation = formation;
    this.stance = DEFAULT_STANCE[formation] ?? 'balanced';
    this.anchorX = x;
    this.anchorY = y;
    this.facing = facing;
    this.initialCount = count;
    this.slots = layoutSlots(formation, count, this.slotScale());
    for (const slot of this.slots) slot.f = facing;
    for (let i = 0; i < count; i++) {
      const [sx, sy] = this.slotWorld(i);
      const id = allocId();
      const jAngle = hash01(id, 1) * Math.PI * 2;
      const jRadius = hash01(id, 2) * 5.5;
      this.soldiers.push({
        id,
        team,
        x: sx,
        y: sy,
        prevX: sx,
        prevY: sy,
        vx: 0,
        vy: 0,
        facing,
        slot: i,
        avoidSide: 0,
        hp: this.unitType.hp,
        targetId: 0,
        cooldown: 0,
        escaped: false,
        chargeBonus: false,
        radius: this.unitType.radius,
        reload: -1,
        jitterX: Math.cos(jAngle) * jRadius,
        jitterY: Math.sin(jAngle) * jRadius,
        pace: 0.93 + hash01(id, 3) * 0.14,
      });
    }
  }

  private slotScale(): number {
    return this.unitType.radius / 7;
  }

  orderMove(x: number, y: number, world: World, facing: number | null = null): void {
    this.attackTarget = null;
    this.pendingAttack = null;
    this.arrivalFacing = facing;
    this.orderX = x;
    this.orderY = y;
    this.rebuildFlow(world);
  }

  /** March on an enemy squad and keep pursuing it as it moves. */
  orderAttack(target: Squad, world: World): void {
    this.attackTarget = target;
    this.pendingAttack = null;
    this.arrivalFacing = null;
    this.orderX = target.anchorX;
    this.orderY = target.anchorY;
    this.rebuildFlow(world);
  }

  /** Swing wide around an enemy squad and hit it from the side once in position. */
  orderFlank(target: Squad, world: World): void {
    const dx = target.anchorX - this.anchorX;
    const dy = target.anchorY - this.anchorY;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    let perpX = -dirY;
    let perpY = dirX;
    // Swing around whichever side keeps the waypoint on the map.
    let wx = target.anchorX + dirX * 200 + perpX * 320;
    let wy = target.anchorY + dirY * 200 + perpY * 320;
    if (wx < 60 || wx > world.widthPx - 60 || wy < 60 || wy > world.heightPx - 60) {
      perpX = -perpX;
      perpY = -perpY;
      wx = target.anchorX + dirX * 200 + perpX * 320;
      wy = target.anchorY + dirY * 200 + perpY * 320;
    }
    wx = Math.min(world.widthPx - 60, Math.max(60, wx));
    wy = Math.min(world.heightPx - 60, Math.max(60, wy));
    this.orderMove(wx, wy, world);
    this.pendingAttack = target;
  }

  /** Stop everything: stand fast where the squad is now. */
  halt(): void {
    this.orderX = null;
    this.orderY = null;
    this.attackTarget = null;
    this.pendingAttack = null;
    this.arrivalFacing = null;
    this.charging = false;
  }

  /** Redraw the frontage (files across) for width-adjustable formations. */
  setWidth(cols: number): void {
    if (!WIDTH_FORMATIONS[this.formation]) return;
    this.widthCols = Math.min(this.soldiers.length, Math.max(2, Math.round(cols)));
    this.rebuildSlots();
  }

  private rebuildSlots(): void {
    this.slots = layoutSlots(
      this.formation,
      this.soldiers.length,
      this.slotScale(),
      this.widthCols ?? undefined,
    );
    for (const slot of this.slots) slot.f = this.facing;
    this.reassignSlots();
  }

  isAttacking(target?: Squad): boolean {
    return target ? this.attackTarget === target : this.attackTarget !== null;
  }

  /** Break into a charge toward the current order. Ends on impact or arrival. */
  startCharge(): void {
    if (this.state === 'steady') this.charging = true;
  }

  /** Standing with nothing to do (halted, steady, out of contact). */
  isIdle(): boolean {
    return this.state === 'steady' && this.orderX === null && !this.inMelee;
  }

  /** Pivot the whole formation toward an angle — used to front toward threats while idle. */
  faceToward(angle: number, dt: number, rateMult = 0.5): void {
    let diff = angle - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * rateMult * dt;
    this.facing += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
  }

  private rebuildFlow(world: World): void {
    if (this.orderX === null || this.orderY === null) return;
    this.flow = new FlowField(world, this.orderX, this.orderY);
    this.flowTargetX = this.orderX;
    this.flowTargetY = this.orderY;
  }

  setFormation(kind: FormationKind): void {
    if (kind === this.formation) return;
    this.formation = kind;
    const def = DEFAULT_STANCE[kind];
    if (def) this.stance = def;
    this.widthCols = null;
    this.rebuildSlots();
  }

  // Greedy nearest-soldier-to-slot matching, front slots first. Not globally optimal,
  // but cheap and avoids the worst criss-crossing when the shape changes.
  private reassignSlots(): void {
    const unassigned = new Set(this.soldiers);
    for (let i = 0; i < this.slots.length; i++) {
      const [sx, sy] = this.slotWorld(i);
      let best: Soldier | null = null;
      let bestD = Infinity;
      for (const s of unassigned) {
        const d = (s.x - sx) ** 2 + (s.y - sy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) {
        best.slot = i;
        unassigned.delete(best);
      }
    }
  }

  slotWorld(index: number): [number, number] {
    const slot = this.slots[index];
    if (!slot) return [this.anchorX, this.anchorY];
    // Each slot rotates around the anchor by its OWN facing, which lags the
    // squad facing during turns — that's what bends the shape through a wheel.
    const f = FORMATION_CURVES[this.formation] ? slot.f : this.facing;
    const fx = Math.cos(f);
    const fy = Math.sin(f);
    // right-hand perpendicular of facing
    const rx = -fy;
    const ry = fx;
    return [
      this.anchorX + rx * slot.lateral - fx * slot.depth,
      this.anchorY + ry * slot.lateral - fy * slot.depth,
    ];
  }

  private updateSlotFacings(dt: number): void {
    if (!FORMATION_CURVES[this.formation]) return;
    for (const slot of this.slots) {
      const offset = Math.abs(slot.lateral) + Math.abs(slot.depth);
      const rate = SLOT_TURN_BASE / (1 + offset / SLOT_TURN_FALLOFF);
      let diff = this.facing - slot.f;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = rate * dt;
      slot.f += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    }
  }

  tick(dt: number, world: World, getSoldier: SoldierLookup): void {
    if (this.state === 'steady') {
      this.moveAnchor(dt, world);
      // After a battle-line order completes, wheel onto the ordered facing.
      if (this.orderX === null && this.arrivalFacing !== null) {
        this.faceToward(this.arrivalFacing, dt, 2);
        let diff = this.arrivalFacing - this.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.04) this.arrivalFacing = null;
      }
    }
    this.updateSlotFacings(dt);
    this.steerSoldiers(dt, world, getSoldier);
  }

  /** Drop the dead, tighten the formation, and break if losses are past the morale lines. */
  removeDead(): Soldier[] {
    const dead = this.soldiers.filter((s) => s.hp <= 0 || s.escaped);
    if (dead.length === 0) return dead;
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i]!;
      if (s.hp <= 0 || s.escaped) this.soldiers.splice(i, 1);
    }
    if (this.soldiers.length > 0) this.rebuildSlots();
    const losses = 1 - this.soldiers.length / this.initialCount;
    if (this.state !== 'fleeing' && losses >= SHATTER_CASUALTY_FRACTION) {
      this.breakAndRun('fleeing');
    } else if (this.state === 'steady' && losses >= ROUT_CASUALTY_FRACTION) {
      // A squad that already rallied once doesn't break twice — it quits the field.
      this.breakAndRun(this.rallied ? 'fleeing' : 'routing');
    }
    return dead;
  }

  private breakAndRun(state: 'routing' | 'fleeing'): void {
    this.state = state;
    this.rallyProgress = 0;
    this.charging = false;
    this.inMelee = false;
    this.attackTarget = null;
    this.orderX = null;
    this.orderY = null;
    this.speed = 0;
    for (const s of this.soldiers) s.targetId = 0;
  }

  /** Routed men regain their nerve: reform on the spot, commandable again. */
  rally(): void {
    if (this.state !== 'routing' || this.soldiers.length === 0) return;
    this.state = 'steady';
    this.rallied = true;
    this.rallyProgress = 0;
    let cx = 0;
    let cy = 0;
    for (const s of this.soldiers) {
      cx += s.x;
      cy += s.y;
    }
    this.anchorX = cx / this.soldiers.length;
    this.anchorY = cy / this.soldiers.length;
    this.reassignSlots();
  }

  private moveAnchor(dt: number, world: World): void {
    // Pursuit: track the target squad's position; refresh the flow field when
    // it has drifted far from where the field was computed.
    if (this.attackTarget) {
      if (this.attackTarget.soldiers.length === 0 || this.attackTarget.state === 'routing') {
        this.attackTarget = null;
        this.orderX = null;
        this.orderY = null;
        return;
      }
      this.orderX = this.attackTarget.anchorX;
      this.orderY = this.attackTarget.anchorY;
      const drift =
        (this.orderX - this.flowTargetX) ** 2 + (this.orderY - this.flowTargetY) ** 2;
      if (drift > 100 * 100) this.rebuildFlow(world);
      // Advance until the soldiers actually collide; then hold the anchor and
      // let the pile-in fight. Exception: during the charge-impact window the
      // formation keeps driving THROUGH the enemy — a charge penetrates the
      // ranks, it doesn't tap the front row and stop.
      if (this.inMelee && this.chargeImpactClock <= 0) {
        this.speed = 0; // the crash of contact eats the momentum
        return;
      }
    }

    if (this.orderX === null || this.orderY === null) {
      this.speed = 0;
      this.charging = false;
      return;
    }
    const dx = this.orderX - this.anchorX;
    const dy = this.orderY - this.anchorY;
    const dist = Math.hypot(dx, dy);
    // Ranged squads attacking halt at firing distance; melee squads close to contact.
    const arriveAt = this.attackTarget
      ? this.unitType.ranged
        ? this.unitType.ranged.range * 0.8
        : 24
      : ARRIVE_RADIUS;
    if (dist < arriveAt) {
      if (!this.attackTarget) {
        this.orderX = null;
        this.orderY = null;
        // Keep the flow field: stragglers still stuck behind trees use it to find their slots.
        // Flank order: waypoint reached — now hit the target from this side.
        if (this.pendingAttack && this.pendingAttack.soldiers.length > 0 && this.pendingAttack.state === 'steady') {
          const t = this.pendingAttack;
          this.orderAttack(t, world);
          return;
        }
      }
      this.speed = 0;
      this.charging = false;
      return;
    }

    // Straight at the target when nothing stands between us; otherwise follow the
    // flow field around whatever is in the way.
    let dirX = dx / dist;
    let dirY = dy / dist;
    if (!losClear(world, this.anchorX, this.anchorY, this.orderX, this.orderY)) {
      const flowDir = this.flow?.direction(this.anchorX, this.anchorY);
      if (flowDir) {
        dirX = flowDir[0];
        dirY = flowDir[1];
      }
    }

    const desired = Math.atan2(dirY, dirX);
    let diff = desired - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    this.facing += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;

    // Wheel: barely advance while facing is far off, full speed once lined up.
    const alignment = Math.max(0.15, Math.cos(diff));
    // Horses tangled in a melee press can barely maneuver — extracting cavalry
    // mid-fight is slow and costly. That's the strategic price of a charge.
    // (Not during the impact window: momentum still carries them through.)
    const bogged = this.inMelee && this.unitType.mounted && this.chargeImpactClock <= 0 ? 0.35 : 1;
    const maxSpeed =
      MARCH_SPEED *
      this.unitType.speedMult *
      FORMATION_SPEED[this.formation] *
      world.speedAt(this.anchorX, this.anchorY) *
      alignment *
      bogged *
      (this.charging ? CHARGE_SPEED_MULT : 1);

    // Momentum: ramp toward the cap, and brake ahead of the stop point so the
    // formation eases in rather than stopping on a dime. For an attack order the
    // "stop" is the enemy — no braking, hit them at full stride.
    const brakeDist = (this.speed * this.speed) / (2 * MARCH_DECEL);
    const targetSpeed = !this.attackTarget && dist <= brakeDist ? 0 : maxSpeed;
    if (this.speed < targetSpeed) {
      const accel = MARCH_ACCEL * (this.charging ? CHARGE_ACCEL_MULT : 1);
      this.speed = Math.min(targetSpeed, this.speed + accel * dt);
    } else {
      this.speed = Math.max(targetSpeed, this.speed - MARCH_DECEL * dt);
    }

    const step = Math.min(dist, this.speed * dt);
    this.anchorX += Math.cos(this.facing) * step;
    this.anchorY += Math.sin(this.facing) * step;
  }

  private steerSoldiers(dt: number, world: World, getSoldier: SoldierLookup): void {
    // Both broken states run for their own map edge; only 'fleeing' actually leaves.
    const routing = this.state !== 'steady';
    const fleeX = this.team === 0 ? -120 : world.widthPx + 120;

    for (const s of this.soldiers) {
      s.prevX = s.x;
      s.prevY = s.y;

      let tx: number;
      let ty: number;
      let stopRange = 0; // how short of the point to pull up (melee: stop at arm's length)
      let flowDir: [number, number] | null = null;

      const target = !routing && s.targetId !== 0 ? getSoldier(s.targetId) : undefined;
      const leash = STANCE_LEASH[this.stance];
      const withinLeash =
        (this.anchorX - s.x) ** 2 + (this.anchorY - s.y) ** 2 <= leash * leash;
      const engaged =
        target !== undefined &&
        target.hp > 0 &&
        withinLeash &&
        (target.x - s.x) ** 2 + (target.y - s.y) ** 2 <= MELEE_PURSUE * MELEE_PURSUE;

      if (routing) {
        tx = fleeX;
        ty = s.y;
      } else if (engaged) {
        tx = target.x;
        ty = target.y;
        stopRange = this.unitType.meleeReach * 0.8;
      } else {
        s.targetId = 0;
        let [slotX, slotY] = this.slotWorld(s.slot);
        const jitter = FORMATION_JITTER[this.formation];
        slotX += s.jitterX * jitter;
        slotY += s.jitterY * jitter;
        // Cohesion ladder: head for the slot; if rocks block that AND we're far from
        // the squad, funnel toward the anchor (so everyone rounds terrain on the SAME
        // side the formation took), or navigate solo by flow field if even the anchor
        // is unreachable. Near the squad, just steer at the slot and let tangent
        // dodging slide around the rock — funneling here deadlocked soldiers standing
        // on the anchor when a rock sat between it and their slot.
        tx = slotX;
        ty = slotY;
        if (!losPassable(world, s.x, s.y, slotX, slotY)) {
          const anchorDist = Math.hypot(this.anchorX - s.x, this.anchorY - s.y);
          if (anchorDist > 90) {
            if (losPassable(world, s.x, s.y, this.anchorX, this.anchorY)) {
              tx = this.anchorX;
              ty = this.anchorY;
            } else {
              flowDir = this.flow?.direction(s.x, s.y) ?? null;
            }
          }
        }
      }

      let dx = tx - s.x;
      let dy = ty - s.y;
      const rawDist = Math.hypot(dx, dy);
      const dist = Math.max(0, rawDist - stopRange);

      if (rawDist > 0.01) {
        dx /= rawDist;
        dy /= rawDist;
        if (flowDir) {
          dx = flowDir[0];
          dy = flowDir[1];
        }
        [dx, dy] = this.avoidObstacles(world, s, dx, dy, flowDir ? AVOID_LOOKAHEAD : dist);
      }

      // Arrive: full speed when far from the goal, easing to a stop on it.
      // Wading through trees cuts speed; a fleeing man finds an extra step.
      let paceMult = routing ? 1.1 : this.charging ? CHARGE_SOLDIER_SPEED_MULT : 1;
      if (engaged) {
        if (this.chargeImpactClock > 0 && s.chargeBonus) {
          // Momentum carries the charger onto his next victim.
          paceMult = 1.1;
        } else {
          // Trading blows = shuffling footwork; closing in = a hustle, not a sprint.
          // A horse in the press is nearly immobile.
          const bog = this.unitType.mounted ? 0.6 : 1;
          paceMult =
            (rawDist < this.unitType.meleeReach * 2 ? FIGHTING_SPEED_MULT : SURGE_SPEED_MULT) * bog;
        }
      }
      const targetSpeed =
        SOLDIER_MAX_SPEED *
        this.unitType.speedMult *
        s.pace *
        Math.min(1, dist / 30) *
        world.speedAt(s.x, s.y) *
        paceMult;
      const desiredVx = dx * targetSpeed;
      const desiredVy = dy * targetSpeed;

      const maxDv = SOLDIER_ACCEL * dt;
      const dvx = desiredVx - s.vx;
      const dvy = desiredVy - s.vy;
      const dv = Math.hypot(dvx, dvy);
      if (dv <= maxDv) {
        s.vx = desiredVx;
        s.vy = desiredVy;
      } else {
        s.vx += (dvx / dv) * maxDv;
        s.vy += (dvy / dv) * maxDv;
      }

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const speed = Math.hypot(s.vx, s.vy);
      if (engaged) {
        s.facing = Math.atan2(target.y - s.y, target.x - s.x);
      } else {
        s.facing = speed > 12 ? Math.atan2(s.vy, s.vx) : this.facing;
      }
    }
  }

  // If an obstacle sits on the soldier's straight path to his slot, aim at its
  // near tangent instead so he flows around it rather than grinding against it.
  private avoidObstacles(
    world: World,
    s: Soldier,
    dirX: number,
    dirY: number,
    distToTarget: number,
  ): [number, number] {
    const look = Math.min(AVOID_LOOKAHEAD, distToTarget);
    // Perpendicular of the travel direction; "side" is measured against it.
    const perpX = -dirY;
    const perpY = dirX;
    let nearestProj = Infinity;
    let steerX = dirX;
    let steerY = dirY;
    let conflicted = false;

    for (const o of world.obstacles) {
      const clearance = o.radius + SOLDIER_RADIUS + 3;
      const ox = o.x - s.x;
      const oy = o.y - s.y;
      const proj = ox * dirX + oy * dirY; // distance along the path to the obstacle's closest approach
      if (proj <= 0 || proj > look + clearance || proj >= nearestProj) continue;
      const offAxis = Math.hypot(dirX * proj - ox, dirY * proj - oy);
      if (offAxis >= clearance) continue;

      conflicted = true;
      nearestProj = proj;
      // Commit to one side for the whole dodge (hysteresis): re-picking the nearer
      // side every tick made soldiers wobble into the tree instead of past it.
      if (s.avoidSide === 0) {
        const cross = ox * perpX + oy * perpY;
        s.avoidSide = cross > 0 ? -1 : 1;
      }
      const aimX = o.x + perpX * s.avoidSide * clearance - s.x;
      const aimY = o.y + perpY * s.avoidSide * clearance - s.y;
      const aimLen = Math.hypot(aimX, aimY);
      if (aimLen > 0.01) {
        steerX = aimX / aimLen;
        steerY = aimY / aimLen;
      }
    }
    if (!conflicted) s.avoidSide = 0;
    return [steerX, steerY];
  }
}
