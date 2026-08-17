import type { Soldier } from './soldier';

// Spatial hash: soldiers bucketed by coarse cell so "who is near me?" checks a
// handful of neighbors instead of every soldier on the field. This is what keeps
// separation and combat targeting fast at 1000v1000.
const GRID_CELL = 64;

export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: Soldier[][];

  constructor(widthPx: number, heightPx: number) {
    this.cols = Math.ceil(widthPx / GRID_CELL);
    this.rows = Math.ceil(heightPx / GRID_CELL);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  rebuild(soldiers: Iterable<Soldier>): void {
    for (const b of this.buckets) b.length = 0;
    for (const s of soldiers) {
      this.buckets[this.bucketIndex(s.x, s.y)]!.push(s);
    }
  }

  forEachNear(x: number, y: number, radius: number, cb: (s: Soldier) => void): void {
    const minCx = Math.max(0, Math.floor((x - radius) / GRID_CELL));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / GRID_CELL));
    const minCy = Math.max(0, Math.floor((y - radius) / GRID_CELL));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / GRID_CELL));
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (const s of this.buckets[cy * this.cols + cx]!) cb(s);
      }
    }
  }

  nearestEnemy(x: number, y: number, myTeam: number, radius: number): Soldier | null {
    let best: Soldier | null = null;
    let bestD2 = radius * radius;
    this.forEachNear(x, y, radius, (s) => {
      if (s.team === myTeam || s.hp <= 0 || s.escaped) return;
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = s;
      }
    });
    return best;
  }

  private bucketIndex(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / GRID_CELL)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / GRID_CELL)));
    return cy * this.cols + cx;
  }
}
