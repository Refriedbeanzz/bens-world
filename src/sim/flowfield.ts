import { CELL, GRID_W, GRID_H, type World } from './world';

// Flow field: Dijkstra outward from the order target over the walkable grid,
// giving every cell its distance-to-target. Descending that field steers a squad
// around obstacle clusters. One field per order — cheap (4000 cells), and any
// number of soldiers can share it.

const SQRT2 = Math.SQRT2;
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class FlowField {
  private readonly cost = new Float64Array(GRID_W * GRID_H).fill(Infinity);

  constructor(world: World, targetX: number, targetY: number) {
    const start = this.nearestWalkable(world, Math.floor(targetX / CELL), Math.floor(targetY / CELL));
    if (start === -1) return;

    // Dijkstra with a small binary heap of [cost, cellIndex].
    const heap: [number, number][] = [[0, start]];
    this.cost[start] = 0;
    while (heap.length > 0) {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        this.siftDown(heap);
      }
      const [c, cell] = top;
      if (c > this.cost[cell]!) continue;
      const cx = cell % GRID_W;
      const cy = Math.floor(cell / GRID_W);
      for (const [dx, dy, step] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        if (world.isBlocked(nx, ny)) continue;
        // No corner-cutting: a diagonal needs both orthogonal cells open.
        if (dx !== 0 && dy !== 0 && (world.isBlocked(cx + dx, cy) || world.isBlocked(cx, cy + dy))) continue;
        const nc = c + step * world.cellCost(nx, ny);
        const ni = ny * GRID_W + nx;
        if (nc < this.cost[ni]!) {
          this.cost[ni] = nc;
          heap.push([nc, ni]);
          this.siftUp(heap);
        }
      }
    }
  }

  /** Direction of steepest descent toward the target from this world position, or null if unreachable. */
  direction(x: number, y: number): [number, number] | null {
    const cx = Math.min(GRID_W - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(GRID_H - 1, Math.max(0, Math.floor(y / CELL)));
    const here = this.cost[cy * GRID_W + cx]!;
    let bestDx = 0;
    let bestDy = 0;
    let bestGain = 0;
    for (const [dx, dy, step] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const c = this.cost[ny * GRID_W + nx]!;
      if (!Number.isFinite(c)) continue;
      // Gain per unit of travel, so diagonals aren't preferred just for spanning more distance.
      const gain = Number.isFinite(here) ? (here - c) / step : 1 / (c + 1);
      if (gain > bestGain) {
        bestGain = gain;
        bestDx = dx;
        bestDy = dy;
      }
    }
    // No downhill neighbor: either we're on the target cell or the target is unreachable.
    if (bestDx === 0 && bestDy === 0) return null;
    const len = Math.hypot(bestDx, bestDy);
    return [bestDx / len, bestDy / len];
  }

  private nearestWalkable(world: World, cx: number, cy: number): number {
    for (let ring = 0; ring < 8; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          if (!world.isBlocked(nx, ny)) return ny * GRID_W + nx;
        }
      }
    }
    return -1;
  }

  private siftUp(heap: [number, number][]): void {
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      const tmp = heap[parent]!;
      heap[parent] = heap[i]!;
      heap[i] = tmp;
      i = parent;
    }
  }

  private siftDown(heap: [number, number][]): void {
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < heap.length && heap[l]![0] < heap[smallest]![0]) smallest = l;
      if (r < heap.length && heap[r]![0] < heap[smallest]![0]) smallest = r;
      if (smallest === i) break;
      const tmp = heap[smallest]!;
      heap[smallest] = heap[i]!;
      heap[i] = tmp;
      i = smallest;
    }
  }
}
