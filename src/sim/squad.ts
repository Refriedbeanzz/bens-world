import { FlowField } from './flowfield';
import { FORMATION_SPEED, layoutSlots, type FormationKind, type Slot } from './formation';
import { SOLDIER_ACCEL, SOLDIER_MAX_SPEED, SOLDIER_RADIUS, type Soldier } from './soldier';
import { CELL, type World } from './world';

const MARCH_SPEED = 60; // how fast the formation anchor slides, px/s
const TURN_RATE = 2.2; // rad/s — formations wheel around rather than snap-rotating
const ARRIVE_RADIUS = 5;
const AVOID_LOOKAHEAD = 70; // how far ahead a soldier scans for an obstacle in his way

let nextSoldierId = 1;

/** True when the straight segment between two points crosses no blocked cell. */
function losClear(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
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
  anchorX: number;
  anchorY: number;
  facing: number;
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

  tick(dt: number, world: World): void {
    this.moveAnchor(dt, world);
    this.steerSoldiers(dt, world);
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
    const speed = MARCH_SPEED * FORMATION_SPEED[this.formation];
    const step = Math.min(dist, speed * alignment * dt);
    this.anchorX += Math.cos(this.facing) * step;
    this.anchorY += Math.sin(this.facing) * step;
  }

  private steerSoldiers(dt: number, world: World): void {
    for (const s of this.soldiers) {
      s.prevX = s.x;
      s.prevY = s.y;

      const [tx, ty] = this.slotWorld(s.slot);
      let dx = tx - s.x;
      let dy = ty - s.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0.01) {
        dx /= dist;
        dy /= dist;
        // A blocked straight path means local dodging isn't enough (tree clusters):
        // follow the squad's flow field, which routes around the whole forest.
        const blocked = !losClear(world, s.x, s.y, tx, ty);
        const flowDir = blocked ? this.flow?.direction(s.x, s.y) : null;
        if (flowDir) {
          dx = flowDir[0];
          dy = flowDir[1];
        }
        [dx, dy] = this.avoidObstacles(world, s, dx, dy, flowDir ? AVOID_LOOKAHEAD : dist);
      }

      // Arrive: full speed when far from the slot, easing to a stop on it.
      const targetSpeed = SOLDIER_MAX_SPEED * Math.min(1, dist / 30);
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
      s.facing = speed > 12 ? Math.atan2(s.vy, s.vx) : this.facing;
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
    let nearestProj = Infinity;
    let steerX = dirX;
    let steerY = dirY;

    for (const o of world.obstacles) {
      const clearance = o.radius + SOLDIER_RADIUS + 3;
      const ox = o.x - s.x;
      const oy = o.y - s.y;
      const proj = ox * dirX + oy * dirY; // distance along the path to the obstacle's closest approach
      if (proj <= 0 || proj > look + clearance || proj >= nearestProj) continue;
      const closestX = dirX * proj - ox;
      const closestY = dirY * proj - oy;
      const offAxis = Math.hypot(closestX, closestY);
      if (offAxis >= clearance) continue;

      nearestProj = proj;
      // Aim at a point beside the obstacle, on whichever side we're already closer to.
      let sideX = closestX;
      let sideY = closestY;
      if (offAxis < 0.01) {
        sideX = -dirY;
        sideY = dirX;
      } else {
        sideX /= offAxis;
        sideY /= offAxis;
      }
      const aimX = o.x + sideX * clearance - s.x;
      const aimY = o.y + sideY * clearance - s.y;
      const aimLen = Math.hypot(aimX, aimY);
      if (aimLen > 0.01) {
        steerX = aimX / aimLen;
        steerY = aimY / aimLen;
      }
    }
    return [steerX, steerY];
  }
}
