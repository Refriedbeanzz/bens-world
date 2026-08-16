// Formation layouts. A formation is a set of SLOTS: local offsets relative to the
// squad's anchor point (front-center of the shape), expressed as lateral (left/right
// across the facing) and depth (distance behind the anchor). Orders move the anchor
// and facing; soldiers chase their slot's world position.

export type FormationKind = 'line' | 'column' | 'wedge' | 'square' | 'wall';

export interface Slot {
  lateral: number;
  depth: number;
}

const SPACING = 22;
// Wall: shoulder-to-shoulder shield-wall spacing (soldier diameter is 14).
const WALL_LATERAL = 15;
const WALL_DEPTH = 16;

export function layoutSlots(kind: FormationKind, count: number): Slot[] {
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
  }
}

function grid(count: number, cols: number, lateralSpacing = SPACING, depthSpacing = SPACING): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    slots.push({
      lateral: (col - (inRow - 1) / 2) * lateralSpacing,
      depth: row * depthSpacing,
    });
  }
  return slots;
}

function wedge(count: number): Slot[] {
  const slots: Slot[] = [];
  let row = 0;
  while (slots.length < count) {
    const inRow = Math.min(row + 1, count - slots.length);
    for (let j = 0; j < inRow; j++) {
      slots.push({
        lateral: (j - (inRow - 1) / 2) * SPACING * 1.25,
        depth: row * SPACING,
      });
    }
    row++;
  }
  return slots;
}
