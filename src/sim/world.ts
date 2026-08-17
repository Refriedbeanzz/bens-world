import { Rng } from './rng';

// World geometry. The battlefield is a grid of cells; obstacles mark cells as blocked,
// which pathfinding reads. A heightmap adds elevation: slopes change movement speed
// (and therefore charge impact power), high ground extends archer range, and cells
// with cliff-steep gradients become impassable walls.
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

export type Biome = 'meadow' | 'steppe' | 'forest';
export type Relief = 'plains' | 'rolling' | 'ridge' | 'canyon';

export interface WorldSpec {
  biome: Biome;
  relief: Relief;
  treeClusters: [number, number];
  rocks: [number, number];
  /** 'river': a meandering river — deep channel impassable, crossable at shallow fords */
  water?: 'river';
}

export const DEFAULT_SPEC: WorldSpec = {
  biome: 'meadow',
  relief: 'rolling',
  treeClusters: [7, 10],
  rocks: [10, 16],
};

// Trees weaken archery (halved range shooting from inside, canopy blocks
// missiles landing inside) and bog HORSES — mounted units crawl through woods
// and their route-planning avoids them. Infantry move through unaffected.
// Rocks and cliffs are hard walls for everyone.
export const TREE_SPEED_FACTOR = 1.0;
const TREE_PATH_COST = 1.0;
const MOUNTED_TREE_SPEED = 0.35;
// Shallow water is slow going for everyone (per-unit waterSpeed stat) and
// pathfinding prefers dry ground / fords over long wades.
const SHALLOW_PATH_COST = 1.8;
export const WATER_NONE = 0;
export const WATER_SHALLOW = 1;
export const WATER_DEEP = 2;
/** Chance the canopy stops a missile whose landing point is in forest. */
export const TREE_MISSILE_BLOCK = 0.55;
/** Range multiplier for a shooter standing in forest. */
export const TREE_SHOOTER_RANGE = 0.5;

// Elevation. Heights are 0..1; slope speed factor looks a step ahead in the
// movement direction. A height delta steeper than CLIFF_DELTA between adjacent
// cells is an unclimbable face.
const SLOPE_K = 6;
const SLOPE_LOOKAHEAD = 26;
// Steeper than any rolling/ridge terrain can produce — only deliberately sheer
// features (canyon walls) generate cliffs.
const CLIFF_DELTA = 0.13;

// Smooth value noise on a coarse lattice, bilinear + smoothstep interpolation.
function makeLatticeNoise(rng: Rng, w: number, h: number): (u: number, v: number) => number {
  const lattice = new Float32Array((w + 1) * (h + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const at = (x: number, y: number) => lattice[y * (w + 1) + x] ?? 0;
  return (u, v) => {
    const x = Math.min(Math.max(u, 0) * w, w - 0.0001);
    const y = Math.min(Math.max(v, 0) * h, h - 0.0001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class World {
  readonly widthPx = GRID_W * CELL;
  readonly heightPx = GRID_H * CELL;
  readonly blocked = new Uint8Array(GRID_W * GRID_H);
  readonly slow = new Uint8Array(GRID_W * GRID_H);
  /** Elevation per cell, 0..1. */
  readonly height = new Float32Array(GRID_W * GRID_H);
  /** Cells blocked because they're a cliff face (for rendering). */
  readonly cliff = new Uint8Array(GRID_W * GRID_H);
  /** 0 = dry, 1 = shallow (slows), 2 = deep (impassable). */
  readonly water = new Uint8Array(GRID_W * GRID_H);
  readonly obstacles: Obstacle[] = [];
  readonly seed: number;
  readonly spec: WorldSpec;

  constructor(seed: number, spec: WorldSpec = DEFAULT_SPEC) {
    this.seed = seed;
    this.spec = spec;
    this.generateHeights();
    this.markCliffs();
    this.generateWater();
    const rng = new Rng(seed);
    this.placeTreeClusters(rng);
    this.placeRocks(rng);
  }

  isBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return true;
    return this.blocked[cy * GRID_W + cx] === 1;
  }

  /** Open = neither a wall nor slowing terrain. */
  isOpen(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return false;
    const i = cy * GRID_W + cx;
    return this.blocked[i] === 0 && this.slow[i] === 0;
  }

  /** Is this cell forest? */
  isSlow(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return false;
    return this.slow[cy * GRID_W + cx] === 1;
  }

  /** Pathfinding cost multiplier for entering this cell (walls are skipped, not costed). */
  cellCost(cx: number, cy: number): number {
    let cost = this.isSlow(cx, cy) ? TREE_PATH_COST : 1;
    if (cx >= 0 && cy >= 0 && cx < GRID_W && cy < GRID_H && this.water[cy * GRID_W + cx] === WATER_SHALLOW) {
      cost *= SHALLOW_PATH_COST;
    }
    return cost;
  }

  /** Movement speed multiplier at a world position (terrain type only, not slope). */
  speedAt(x: number, y: number, mounted = false): number {
    if (!this.isSlow(Math.floor(x / CELL), Math.floor(y / CELL))) return 1;
    return mounted ? MOUNTED_TREE_SPEED : TREE_SPEED_FACTOR;
  }

  /** Combined terrain speed factor (trees + water) for a unit at a world position. */
  moveFactor(x: number, y: number, unit: { mounted: boolean; waterSpeed: number }): number {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return 1;
    const i = cy * GRID_W + cx;
    let f = 1;
    if (this.slow[i] === 1) f *= unit.mounted ? MOUNTED_TREE_SPEED : TREE_SPEED_FACTOR;
    if (this.water[i] === WATER_SHALLOW) f *= unit.waterSpeed;
    return f;
  }

  /**
   * Nearest non-blocked point to (x, y), searching outward ring by ring.
   * Used to keep computed destinations (AI staging points, flank waypoints)
   * out of rivers/cliffs — an order aimed AT solid terrain leaves a squad
   * pressed against it forever.
   */
  nearestOpenPoint(x: number, y: number, maxRing = 12): [number, number] {
    const cx0 = Math.floor(x / CELL);
    const cy0 = Math.floor(y / CELL);
    if (!this.isBlocked(cx0, cy0)) return [x, y];
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) continue;
          if (!this.isBlocked(cx, cy)) return [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
        }
      }
    }
    return [x, y];
  }

  /** True when the straight segment between two points crosses no blocked cell. */
  lineWalkable(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / (CELL / 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlocked(Math.floor((x0 + dx * t) / CELL), Math.floor((y0 + dy * t) / CELL))) {
        return false;
      }
    }
    return true;
  }

  /** True when the straight segment crosses no physically solid cell (cliff/deep water). */
  lineHardFree(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / (CELL / 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isHardAt(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  /** Physically solid ground a soldier can never occupy (cliffs, deep water). */
  isHardAt(x: number, y: number): boolean {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return false;
    const i = cy * GRID_W + cx;
    return this.cliff[i] === 1 || this.water[i] === WATER_DEEP;
  }

  /** Is this world position under forest canopy? */
  inTrees(x: number, y: number): boolean {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return false;
    return this.slow[cy * GRID_W + cx] === 1;
  }

  /** Bilinear elevation at a world position, 0..1. */
  heightAt(x: number, y: number): number {
    const gx = Math.min(GRID_W - 1.001, Math.max(0, x / CELL - 0.5));
    const gy = Math.min(GRID_H - 1.001, Math.max(0, y / CELL - 0.5));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const h = (cx: number, cy: number) => this.height[Math.min(GRID_H - 1, cy) * GRID_W + Math.min(GRID_W - 1, cx)]!;
    const top = h(x0, y0) * (1 - fx) + h(x0 + 1, y0) * fx;
    const bot = h(x0, y0 + 1) * (1 - fx) + h(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  }

  /**
   * Smoothly interpolated "wetness" for RENDERING only (0 = dry, 0.55 =
   * shallow, 1 = deep) — the gameplay `water` grid stays a hard per-cell
   * classification for blocking/pathfinding, unchanged. This just lets the
   * renderer blend a river's color across a cell boundary instead of
   * stepping abruptly, so the shoreline reads as a curve, not a staircase.
   */
  waterAt(x: number, y: number): number {
    return this.bilinear(this.water, x, y, (v) => (v === 2 ? 1 : v === 1 ? 0.55 : 0));
  }

  /** Smoothly interpolated cliff strength (0..1) for rendering, same idea as waterAt. */
  cliffAt(x: number, y: number): number {
    return this.bilinear(this.cliff, x, y, (v) => v);
  }

  private bilinear(arr: Uint8Array, x: number, y: number, map: (v: number) => number): number {
    const gx = Math.min(GRID_W - 1.001, Math.max(0, x / CELL - 0.5));
    const gy = Math.min(GRID_H - 1.001, Math.max(0, y / CELL - 0.5));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const at = (cx: number, cy: number) =>
      map(arr[Math.min(GRID_H - 1, cy) * GRID_W + Math.min(GRID_W - 1, cx)]!);
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  }

  /**
   * Slope speed multiplier for moving from (x, y) in direction (dirX, dirY):
   * uphill < 1, downhill > 1. Feeds charge impact power automatically.
   */
  slopeSpeedFactor(x: number, y: number, dirX: number, dirY: number): number {
    const dh =
      this.heightAt(x + dirX * SLOPE_LOOKAHEAD, y + dirY * SLOPE_LOOKAHEAD) - this.heightAt(x, y);
    return Math.min(1.35, Math.max(0.55, 1 - dh * SLOPE_K));
  }

  /** Archery range multiplier from shooting up- or downhill. */
  highGroundRangeMult(sx: number, sy: number, tx: number, ty: number): number {
    return Math.min(1.3, Math.max(0.8, 1 + (this.heightAt(sx, sy) - this.heightAt(tx, ty)) * 0.6));
  }

  private generateHeights(): void {
    const noise = makeLatticeNoise(new Rng(this.seed ^ 0x9137), 10, 7);
    for (let cy = 0; cy < GRID_H; cy++) {
      for (let cx = 0; cx < GRID_W; cx++) {
        const u = cx / (GRID_W - 1);
        const v = cy / (GRID_H - 1);
        const n = noise(u, v) - 0.5;
        const x = cx * CELL + CELL / 2;
        const y = cy * CELL + CELL / 2;
        let h: number;
        switch (this.spec.relief) {
          case 'plains':
            h = 0.5 + n * 0.06;
            break;
          case 'rolling':
            h = 0.5 + n * 0.4;
            break;
          case 'ridge': {
            // A long high ground running down the center of the field.
            const d = x - this.widthPx / 2;
            h = 0.32 + 0.52 * Math.exp(-((d / 230) ** 2)) + n * 0.12;
            break;
          }
          case 'canyon': {
            // High plateaus above and below a wide low corridor. The transition
            // band is cliff-steep — the corridor is the battlefield.
            const dy = Math.abs(y - this.heightPx / 2);
            h = 0.22 + 0.66 * smoothstep(380, 500, dy) + n * 0.05;
            break;
          }
        }
        this.height[cy * GRID_W + cx] = Math.min(1, Math.max(0, h));
      }
    }
  }

  // A meandering river: deep channel down the middle (impassable), shallow
  // banks, and two shallow fords where the whole width is wadeable.
  private generateWater(): void {
    if (this.spec.water !== 'river') return;
    const rng = new Rng(this.seed ^ 0x77a7e4);
    const meander = makeLatticeNoise(rng, 1, 5);
    const ford1 = rng.range(0.18, 0.34) * this.heightPx;
    const ford2 = rng.range(0.64, 0.82) * this.heightPx;
    for (let cy = 0; cy < GRID_H; cy++) {
      const y = cy * CELL + CELL / 2;
      const centerX = this.widthPx / 2 + (meander(0.5, cy / (GRID_H - 1)) - 0.5) * 600;
      const nearFord = Math.abs(y - ford1) < 80 || Math.abs(y - ford2) < 80;
      for (let cx = 0; cx < GRID_W; cx++) {
        const dx = Math.abs(cx * CELL + CELL / 2 - centerX);
        const i = cy * GRID_W + cx;
        if (dx < 42) {
          if (nearFord) {
            this.water[i] = WATER_SHALLOW;
          } else {
            this.water[i] = WATER_DEEP;
            this.blocked[i] = 1;
          }
        } else if (dx < 88) {
          this.water[i] = WATER_SHALLOW;
        }
      }
    }
  }

  private markCliffs(): void {
    for (let cy = 0; cy < GRID_H; cy++) {
      for (let cx = 0; cx < GRID_W; cx++) {
        const i = cy * GRID_W + cx;
        const h = this.height[i]!;
        const steep =
          (cx > 0 && Math.abs(h - this.height[i - 1]!) > CLIFF_DELTA) ||
          (cx < GRID_W - 1 && Math.abs(h - this.height[i + 1]!) > CLIFF_DELTA) ||
          (cy > 0 && Math.abs(h - this.height[i - GRID_W]!) > CLIFF_DELTA) ||
          (cy < GRID_H - 1 && Math.abs(h - this.height[i + GRID_W]!) > CLIFF_DELTA);
        if (steep) {
          this.blocked[i] = 1;
          this.cliff[i] = 1;
        }
      }
    }
  }

  private placeTreeClusters(rng: Rng): void {
    // Own RNG stream for the size roll, so adding tree-size variety doesn't
    // shift how many values are drawn from `rng` — which would silently
    // change where every rock afterward lands for a given seed.
    const sizeRng = new Rng(this.seed ^ 0x7a3c91);
    const clusters = rng.int(this.spec.treeClusters[0], this.spec.treeClusters[1]);
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
        // Mostly modest trees, with an occasional big old one for size variety.
        const big = sizeRng.next() < 0.16;
        this.addObstacle({
          kind: 'tree',
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          radius: big ? rng.range(26, 34) : rng.range(11, 19),
        });
      }
    }
  }

  private placeRocks(rng: Rng): void {
    const rocks = rng.int(this.spec.rocks[0], this.spec.rocks[1]);
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
    // Don't drop obstacles onto cliff faces or into the river.
    const ocx = Math.floor(o.x / CELL);
    const ocy = Math.floor(o.y / CELL);
    if (this.isBlocked(ocx, ocy)) return;
    if (ocx >= 0 && ocy >= 0 && ocx < GRID_W && ocy < GRID_H && this.water[ocy * GRID_W + ocx] !== WATER_NONE) return;
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
        // Rocks get a tight blocked halo (routing hugs them close); tree cells
        // keep a generous slow-marking for future terrain mechanics.
        const margin = o.kind === 'rock' ? CELL * 0.15 : CELL * 0.4;
        if (dx * dx + dy * dy <= (o.radius + margin) ** 2) {
          if (o.kind === 'rock') this.blocked[cy * GRID_W + cx] = 1;
          else this.slow[cy * GRID_W + cx] = 1;
        }
      }
    }
  }
}
