// Unit type definitions — every stat that distinguishes a pikeman from a knight.
// Damage/cooldown/reload ranges are [min, max] rolled per swing/shot.

export type UnitKey = 'swordsman' | 'pikeman' | 'archer' | 'crossbowman' | 'knight' | 'cavalry';

export interface RangedProfile {
  range: number;
  damage: [number, number];
  reload: [number, number];
  projectileSpeed: number;
  /** visual arc height of the projectile, world px */
  arcHeight: number;
  /** bolts punch through armor; arrows don't */
  pierce: boolean;
}

export interface UnitType {
  key: UnitKey;
  name: string;
  hp: number;
  /** flat damage reduction from melee and (non-pierce) missiles, min 1 gets through */
  armor: number;
  meleeDamage: [number, number];
  meleeCooldown: [number, number];
  meleeReach: number;
  /** walk-speed multiplier for both the formation anchor and the soldiers */
  speedMult: number;
  radius: number;
  mounted: boolean;
  /** pikes blunt charge impacts and skewer mounted enemies */
  pike: boolean;
  /** extra damage armed on each soldier's first swing after a charge impact */
  chargeBonus: [number, number];
  ranged: RangedProfile | null;
}

export const UNIT_TYPES: Record<UnitKey, UnitType> = {
  swordsman: {
    key: 'swordsman',
    name: 'Swordsmen',
    hp: 100,
    armor: 2,
    meleeDamage: [6, 9],
    meleeCooldown: [1.3, 1.85],
    meleeReach: 19,
    speedMult: 1.0,
    radius: 7,
    mounted: false,
    pike: false,
    chargeBonus: [10, 16],
    ranged: null,
  },
  pikeman: {
    key: 'pikeman',
    name: 'Pikemen',
    hp: 100,
    armor: 1,
    meleeDamage: [6, 10],
    meleeCooldown: [1.6, 2.2],
    meleeReach: 32,
    speedMult: 0.95,
    radius: 7,
    mounted: false,
    pike: true,
    chargeBonus: [8, 12],
    ranged: null,
  },
  archer: {
    key: 'archer',
    name: 'Archers',
    hp: 90,
    armor: 0,
    meleeDamage: [3, 5],
    meleeCooldown: [1.4, 2.0],
    meleeReach: 17,
    speedMult: 1.05,
    radius: 7,
    mounted: false,
    pike: false,
    chargeBonus: [4, 8],
    ranged: {
      range: 320,
      damage: [9, 14],
      reload: [3.2, 4.2],
      projectileSpeed: 240,
      arcHeight: 42,
      pierce: false,
    },
  },
  crossbowman: {
    key: 'crossbowman',
    name: 'Crossbowmen',
    hp: 95,
    armor: 1,
    meleeDamage: [4, 6],
    meleeCooldown: [1.4, 2.0],
    meleeReach: 17,
    speedMult: 0.95,
    radius: 7,
    mounted: false,
    pike: false,
    chargeBonus: [4, 8],
    ranged: {
      range: 250,
      damage: [16, 24],
      reload: [5.5, 7.0],
      projectileSpeed: 320,
      arcHeight: 14,
      pierce: true,
    },
  },
  knight: {
    key: 'knight',
    name: 'Knights',
    hp: 190,
    armor: 5,
    meleeDamage: [9, 14],
    meleeCooldown: [1.4, 1.9],
    meleeReach: 22,
    speedMult: 1.8,
    radius: 9,
    mounted: true,
    pike: false,
    chargeBonus: [22, 32],
    ranged: null,
  },
  cavalry: {
    key: 'cavalry',
    name: 'Cavalry',
    hp: 150,
    armor: 2,
    meleeDamage: [7, 11],
    meleeCooldown: [1.3, 1.8],
    meleeReach: 20,
    speedMult: 2.1,
    radius: 9,
    mounted: true,
    pike: false,
    chargeBonus: [14, 22],
    ranged: null,
  },
};
