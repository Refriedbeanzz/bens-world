export const SOLDIER_RADIUS = 7;
export const SOLDIER_MAX_SPEED = 95; // px/s — faster than the formation marches, so laggards catch up
export const SOLDIER_ACCEL = 400;

export interface Soldier {
  id: number;
  team: number;
  x: number;
  y: number;
  // Position at the previous sim tick, kept so rendering can interpolate between ticks.
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  facing: number;
  slot: number;
  // Which side (+1/-1) this soldier committed to when skirting an obstacle;
  // 0 when unobstructed. Prevents flip-flopping between sides mid-dodge.
  avoidSide: number;
}
