// Formation layouts. A formation is a set of SLOTS: local offsets relative to the
// squad's anchor point (front-center of the shape), expressed as lateral (left/right
// across the facing) and depth (distance behind the anchor). Orders move the anchor
// and facing; soldiers chase their slot's world position.

export type FormationKind = 'line' | 'column' | 'wedge' | 'square';

export interface Slot {
  lateral: number;
  depth: number;
}

const SPACING = 22;

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
  }
}

function grid(count: number, cols: number): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    slots.push({
      lateral: (col - (inRow - 1) / 2) * SPACING,
      depth: row * SPACING,
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
