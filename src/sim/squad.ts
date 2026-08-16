import { layoutSlots, type FormationKind, type Slot } from './formation';
import { SOLDIER_ACCEL, SOLDIER_MAX_SPEED, SOLDIER_RADIUS, type Soldier } from './soldier';
import type { World } from './world';

const MARCH_SPEED = 60; // how fast the formation anchor slides, px/s
const TURN_RATE = 2.2; // rad/s — formations wheel around rather than snap-rotating
const ARRIVE_RADIUS = 5;

let nextSoldierId = 1;

export class Squad {
  readonly soldiers: Soldier[] = [];
  formation: FormationKind;
  anchorX: number;
  anchorY: number;
  facing: number;
  private slots: Slot[];
  private orderX: number | null = null;
  private orderY: number | null = null;

  constructor(team: number, count: number, x: number, y: number, facing: number, formation: FormationKind) {
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

  orderMove(x: number, y: number): void {
    this.orderX = x;
    this.orderY = y;
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
    this.moveAnchor(dt);
    this.steerSoldiers(dt);
    this.separate();
    this.pushOutOfObstacles(world);
  }

  private moveAnchor(dt: number): void {
    if (this.orderX === null || this.orderY === null) return;
    const dx = this.orderX - this.anchorX;
    const dy = this.orderY - this.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist < ARRIVE_RADIUS) {
      this.orderX = null;
      this.orderY = null;
      return;
    }

    const desired = Math.atan2(dy, dx);
    let diff = desired - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    this.facing += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;

    // Wheel: barely advance while facing is far off, full speed once lined up.
    const alignment = Math.max(0.15, Math.cos(diff));
    const step = Math.min(dist, MARCH_SPEED * alignment * dt);
    this.anchorX += Math.cos(this.facing) * step;
    this.anchorY += Math.sin(this.facing) * step;
  }

  private steerSoldiers(dt: number): void {
    for (const s of this.soldiers) {
      s.prevX = s.x;
      s.prevY = s.y;

      const [tx, ty] = this.slotWorld(s.slot);
      const dx = tx - s.x;
      const dy = ty - s.y;
      const dist = Math.hypot(dx, dy);

      // Arrive: full speed when far from the slot, easing to a stop on it.
      const targetSpeed = SOLDIER_MAX_SPEED * Math.min(1, dist / 30);
      const desiredVx = dist > 0.01 ? (dx / dist) * targetSpeed : 0;
      const desiredVy = dist > 0.01 ? (dy / dist) * targetSpeed : 0;

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

  // Pairwise push-apart within the squad so soldiers keep personal space.
  private separate(): void {
    const minDist = SOLDIER_RADIUS * 2;
    const n = this.soldiers.length;
    for (let i = 0; i < n; i++) {
      const a = this.soldiers[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = this.soldiers[j]!;
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

  // Minimal obstacle handling until BW2 pathfinding: slide soldiers out of tree/rock circles.
  private pushOutOfObstacles(world: World): void {
    for (const s of this.soldiers) {
      for (const o of world.obstacles) {
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
