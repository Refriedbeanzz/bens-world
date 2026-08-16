import { Rng } from './rng';

// World geometry. The battlefield is a grid of cells; obstacles mark cells as blocked,
// which pathfinding (BW2) will read.
export const CELL = 32;
export const GRID_W = 80;
export const GRID_H = 50;

export type ObstacleKind = 'tree' | 'rock';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  radius: number;
}

export class World {
  readonly widthPx = GRID_W * CELL;
  readonly heightPx = GRID_H * CELL;
  readonly blocked = new Uint8Array(GRID_W * GRID_H);
  readonly obstacles: Obstacle[] = [];
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    const rng = new Rng(seed);
    this.placeTreeClusters(rng);
    this.placeRocks(rng);
  }

  isBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return true;
    return this.blocked[cy * GRID_W + cx] === 1;
  }

  private placeTreeClusters(rng: Rng): void {
    const clusters = rng.int(7, 10);
    for (let c = 0; c < clusters; c++) {
      const cx = rng.range(this.widthPx * 0.06, this.widthPx * 0.94);
      const cy = rng.range(this.heightPx * 0.08, this.heightPx * 0.92);
      // Keep the middle third of the field mostly open so armies have room to meet.
      const inCenter = cx > this.widthPx * 0.38 && cx < this.widthPx * 0.62;
      const trees = inCenter ? rng.int(2, 4) : rng.int(5, 12);
      const spread = rng.range(60, 140);
      for (let t = 0; t < trees; t++) {
        const angle = rng.range(0, Math.PI * 2);
        const dist = spread * Math.sqrt(rng.next());
        this.addObstacle({
          kind: 'tree',
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          radius: rng.range(12, 20),
        });
      }
    }
  }

  private placeRocks(rng: Rng): void {
    const rocks = rng.int(10, 16);
    for (let r = 0; r < rocks; r++) {
      this.addObstacle({
        kind: 'rock',
        x: rng.range(40, this.widthPx - 40),
        y: rng.range(40, this.heightPx - 40),
        radius: rng.range(10, 26),
      });
    }
  }

  private addObstacle(o: Obstacle): void {
    if (o.x < CELL || o.y < CELL || o.x > this.widthPx - CELL || o.y > this.heightPx - CELL) return;
    this.obstacles.push(o);
    const minCx = Math.floor((o.x - o.radius) / CELL);
    const maxCx = Math.floor((o.x + o.radius) / CELL);
    const minCy = Math.floor((o.y - o.radius) / CELL);
    const maxCy = Math.floor((o.y + o.radius) / CELL);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) continue;
        const centerX = cx * CELL + CELL / 2;
        const centerY = cy * CELL + CELL / 2;
        const dx = centerX - o.x;
        const dy = centerY - o.y;
        if (dx * dx + dy * dy <= (o.radius + CELL * 0.4) ** 2) {
          this.blocked[cy * GRID_W + cx] = 1;
        }
      }
    }
  }
}
