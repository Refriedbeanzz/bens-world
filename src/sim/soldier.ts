export const SOLDIER_RADIUS = 7;
export const SOLDIER_MAX_SPEED = 95; // px/s — faster than the formation marches, so laggards catch up
export const SOLDIER_ACCEL = 400;

export const SOLDIER_HP = 100;
// Melee ranges: quietly acquire a target inside ENGAGE; once the squad is in
// contact, everyone acquires out to SURGE and piles in; chase a target out to
// PURSUE; swing when inside REACH.
export const MELEE_ENGAGE = 34;
export const MELEE_SURGE = 160;
export const MELEE_PURSUE = 210;
export const MELEE_REACH = 19;

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
  hp: number;
  // id of the enemy this soldier is fighting, 0 when disengaged
  targetId: number;
  cooldown: number;
  // routed soldier that made it off the map edge
  escaped: boolean;
}
