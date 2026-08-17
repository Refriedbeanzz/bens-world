// Formation layouts. A formation is a set of SLOTS: local offsets relative to the
// squad's anchor point (front-center of the shape), expressed as lateral (left/right
// across the facing) and depth (distance behind the anchor). Orders move the anchor
// and facing; soldiers chase their slot's world position.

export type FormationKind = 'line' | 'column' | 'wedge' | 'square' | 'wall' | 'loose' | 'circle';

// March-speed multiplier per formation: packed shapes (wall) and shapes that must
// hold a point (wedge) creep; open-order shapes cover ground fast.
export const FORMATION_SPEED: Record<FormationKind, number> = {
  line: 1.15,
  loose: 1.25,
  column: 1.0,
  square: 0.9,
  wedge: 0.75,
  wall: 0.65,
  circle: 0.7,
};

export interface Slot {
  lateral: number;
  depth: number;
  /** this slot's own current facing — lags the squad facing during turns so the shape curves */
  f: number;
}

const SPACING = 22;
// Wall: shoulder-to-shoulder shield-wall spacing (soldier diameter is 14).
const WALL_LATERAL = 15;
const WALL_DEPTH = 16;
// Loose: open order — skirmish spread, roughly double normal elbow room.
const LOOSE_SPACING = 38;

// Formations that bend through turns (flanks and rear ranks lag the wheel).
// Walls, columns, and squares march as rigid drilled blocks.
export const FORMATION_CURVES: Record<FormationKind, boolean> = {
  line: true,
  wedge: true,
  loose: true,
  circle: true,
  wall: false,
  column: false,
  square: false,
};

// How much of a soldier's personal slot-jitter each formation tolerates:
// drilled-tight shapes suppress it, open order amplifies it.
export const FORMATION_JITTER: Record<FormationKind, number> = {
  line: 1,
  column: 1,
  wedge: 1,
  square: 1,
  wall: 0.35,
  loose: 1.6,
  circle: 0.6,
};

/** scale: spacing multiplier — mounted units need more room (radius / footman radius). */
export function layoutSlots(kind: FormationKind, count: number, scale = 1): Slot[] {
  const slots = ((): Slot[] => {
    switch (kind) {
      case 'line':
        return grid(count, Math.ceil(count / 3));
      case 'column':
        return grid(count, 4);
      case 'square':
        return grid(count, Math.ceil(Math.sqrt(count)));
      case 'wedge':
        return wedge(count);
      case 'wall':
        return grid(count, Math.ceil(count / 2), WALL_LATERAL, WALL_DEPTH);
      case 'loose':
        return grid(count, Math.ceil(count / 3), LOOSE_SPACING, LOOSE_SPACING);
      case 'circle':
        return circleSlots(count);
    }
  })();
  if (scale !== 1) {
    for (const s of slots) {
      s.lateral *= scale;
      s.depth *= scale;
    }
  }
  return slots;
}

function grid(count: number, cols: number, lateralSpacing = SPACING, depthSpacing = SPACING): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    slots.push({ f: 0,
      lateral: (col - (inRow - 1) / 2) * lateralSpacing,
      depth: row * depthSpacing,
    });
  }
  return slots;
}

// Defensive ring centered on the anchor: concentric circles filled from the
// outside in — the future home of all-around shield/pike defense.
function circleSlots(count: number): Slot[] {
  const capacity = (outer: number): number => {
    let cap = 1;
    for (let r = outer; r >= SPACING * 0.9; r -= SPACING) {
      cap += Math.max(1, Math.floor((2 * Math.PI * r) / SPACING));
    }
    return cap;
  };
  let outer = SPACING;
  while (capacity(outer) < count) outer += SPACING;

  const slots: Slot[] = [];
  for (let r = outer; r >= SPACING * 0.9 && slots.length < count; r -= SPACING) {
    const n = Math.max(1, Math.floor((2 * Math.PI * r) / SPACING));
    for (let i = 0; i < n && slots.length < count; i++) {
      const a = (i / n) * Math.PI * 2;
      slots.push({ lateral: Math.cos(a) * r, depth: Math.sin(a) * r, f: 0 });
    }
  }
  while (slots.length < count) slots.push({ lateral: 0, depth: 0, f: 0 });
  return slots;
}

function wedge(count: number): Slot[] {
  const slots: Slot[] = [];
  let row = 0;
  while (slots.length < count) {
    const inRow = Math.min(row + 1, count - slots.length);
    for (let j = 0; j < inRow; j++) {
      slots.push({ f: 0,
        lateral: (j - (inRow - 1) / 2) * SPACING * 1.25,
        depth: row * SPACING,
      });
    }
    row++;
  }
  return slots;
}
