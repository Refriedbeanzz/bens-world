import { FlowField } from './flowfield';
import { FORMATION_SPEED, layoutSlots, type FormationKind, type Slot } from './formation';
import {
  MELEE_KEEP,
  MELEE_REACH,
  SOLDIER_ACCEL,
  SOLDIER_HP,
  SOLDIER_MAX_SPEED,
  SOLDIER_RADIUS,
  type Soldier,
} from './soldier';
import { CELL, type World } from './world';

const MARCH_SPEED = 60; // how fast the formation anchor slides, px/s
const TURN_RATE = 2.2; // rad/s — formations wheel around rather than snap-rotating
const ARRIVE_RADIUS = 5;
const AVOID_LOOKAHEAD = 70; // how far ahead a soldier scans for an obstacle in his way
// A squad breaks and runs after losing this fraction of its starting men.
const ROUT_CASUALTY_FRACTION = 0.4;

export type SquadState = 'steady' | 'routing';
export type SoldierLookup = (id: number) => Soldier | undefined;

let nextSoldierId = 1;

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
  readonly soldiers: Soldier[] = [];
  formation: FormationKind;
  state: SquadState = 'steady';
  anchorX: number;
  anchorY: number;
  facing: number;
  private readonly initialCount: number;
  private slots: Slot[];
  private orderX: number | null = null;
  private orderY: number | null = null;
  private flow: FlowField | null = null;

  constructor(team: number, count: number, x: number, y: number, facing: number, formation: FormationKind) {
    this.team = team;
    this.formation = formation;
    this.anchorX = x;
    this.anchorY = y;
    this.facing = facing;
    this.initialCount = count;
    this.slots = layoutSlots(formation, count);
    for (let i = 0; i < count; i++) {
      const [sx, sy] = this.slotWorld(i);
      this.soldiers.push({
        id: nextSoldierId++,
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
        hp: SOLDIER_HP,
        targetId: 0,
        cooldown: 0,
        escaped: false,
      });
    }
  }

  orderMove(x: number, y: number, world: World): void {
    this.orderX = x;
    this.orderY = y;
    this.flow = new FlowField(world, x, y);
  }

  setFormation(kind: FormationKind): void {
    if (kind === this.formation) return;
    this.formation = kind;
    this.slots = layoutSlots(kind, this.soldiers.length);
    this.reassignSlots();
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
    const fx = Math.cos(this.facing);
    const fy = Math.sin(this.facing);
    // right-hand perpendicular of facing
    const rx = -fy;
    const ry = fx;
    return [
      this.anchorX + rx * slot.lateral - fx * slot.depth,
      this.anchorY + ry * slot.lateral - fy * slot.depth,
    ];
  }

  tick(dt: number, world: World, getSoldier: SoldierLookup): void {
    if (this.state === 'steady') this.moveAnchor(dt, world);
    this.steerSoldiers(dt, world, getSoldier);
  }

  /** Drop the dead, tighten the formation, and break if losses are past the morale line. */
  removeDead(): Soldier[] {
    const dead = this.soldiers.filter((s) => s.hp <= 0 || s.escaped);
    if (dead.length === 0) return dead;
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i]!;
      if (s.hp <= 0 || s.escaped) this.soldiers.splice(i, 1);
    }
    if (this.soldiers.length > 0) {
      this.slots = layoutSlots(this.formation, this.soldiers.length);
      this.reassignSlots();
    }
    if (
      this.state === 'steady' &&
      this.soldiers.length <= this.initialCount * (1 - ROUT_CASUALTY_FRACTION)
    ) {
      this.state = 'routing';
      for (const s of this.soldiers) s.targetId = 0;
    }
    return dead;
  }

  private moveAnchor(dt: number, world: World): void {
    if (this.orderX === null || this.orderY === null) return;
    const dx = this.orderX - this.anchorX;
    const dy = this.orderY - this.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_RADIUS) {
      this.orderX = null;
      this.orderY = null;
      // Keep the flow field: stragglers still stuck behind trees use it to find their slots.
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
    const speed = MARCH_SPEED * FORMATION_SPEED[this.formation] * world.speedAt(this.anchorX, this.anchorY);
    const step = Math.min(dist, speed * alignment * dt);
    this.anchorX += Math.cos(this.facing) * step;
    this.anchorY += Math.sin(this.facing) * step;
  }

  private steerSoldiers(dt: number, world: World, getSoldier: SoldierLookup): void {
    const routing = this.state === 'routing';
    // Routed soldiers run for their own map edge.
    const fleeX = this.team === 0 ? -120 : world.widthPx + 120;

    for (const s of this.soldiers) {
      s.prevX = s.x;
      s.prevY = s.y;

      let tx: number;
      let ty: number;
      let stopRange = 0; // how short of the point to pull up (melee: stop at arm's length)
      let flowDir: [number, number] | null = null;

      const target = !routing && s.targetId !== 0 ? getSoldier(s.targetId) : undefined;
      const engaged =
        target !== undefined &&
        target.hp > 0 &&
        (target.x - s.x) ** 2 + (target.y - s.y) ** 2 <= MELEE_KEEP * MELEE_KEEP;

      if (routing) {
        tx = fleeX;
        ty = s.y;
      } else if (engaged) {
        tx = target.x;
        ty = target.y;
        stopRange = MELEE_REACH * 0.8;
      } else {
        s.targetId = 0;
        const [slotX, slotY] = this.slotWorld(s.slot);
        // Cohesion ladder: head for the slot; if rocks block that, funnel toward the
        // squad anchor (so everyone rounds the forest on the SAME side the formation
        // took); only navigate solo by flow field if even the anchor is unreachable.
        tx = slotX;
        ty = slotY;
        if (!losPassable(world, s.x, s.y, slotX, slotY)) {
          if (losPassable(world, s.x, s.y, this.anchorX, this.anchorY)) {
            tx = this.anchorX;
            ty = this.anchorY;
          } else {
            flowDir = this.flow?.direction(s.x, s.y) ?? null;
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
      const panic = routing ? 1.1 : 1;
      const targetSpeed = SOLDIER_MAX_SPEED * Math.min(1, dist / 30) * world.speedAt(s.x, s.y) * panic;
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
