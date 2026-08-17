import type { Battle } from './battle';
import type { Squad } from './squad';

// The enemy AI commander: a combined-arms brain that thinks every ~1.5s.
//  - Infantry advances as a cohesive line and engages together.
//  - Ranged squads hold a screened position behind the line, falling back when
//    threatened, and shoot on their own (auto-fire).
//  - Cavalry rides down routed squads, flank-charges exposed archers,
//    rear-charges enemies pinned in melee, and pulls itself out when bogged.
//  - Mauled squads withdraw to the rear.
// Deterministic: decisions read battle state only.

const THINK_INTERVAL = 1.5;
const INFANTRY_ENGAGE = 380; // switch from advancing to attack orders inside this
const ADVANCE_STEP = 170;
const COHESION_LAG = 200; // don't outrun the rest of the line by more than this
const RANGED_BACKOFF = 190; // ranged stand this far behind the infantry line
const RANGED_PANIC = 170; // an enemy this close sends ranged running further back
const RANGED_SPREAD = 150;
const CAV_MELEE_LIMIT = 7; // seconds bogged before cavalry extracts itself
const MAULED_FRACTION = 0.5;

interface Mem {
  meleeSec: number;
  lastMoveX: number;
  lastMoveY: number;
  extracting: boolean;
  flanking: Squad | null;
  side: number;
}

function d(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function soldierCentroid(squad: Squad): [number, number] {
  let x = 0;
  let y = 0;
  for (const s of squad.soldiers) {
    x += s.x;
    y += s.y;
  }
  const n = squad.soldiers.length || 1;
  return [x / n, y / n];
}

export class AiCommander {
  private clock = THINK_INTERVAL; // act on the first think tick
  private readonly memory = new Map<Squad, Mem>();
  private sideCounter = 1;

  constructor(private readonly team: number) {}

  private mem(squad: Squad): Mem {
    let m = this.memory.get(squad);
    if (!m) {
      this.sideCounter = -this.sideCounter;
      m = { meleeSec: 0, lastMoveX: NaN, lastMoveY: NaN, extracting: false, flanking: null, side: this.sideCounter };
      this.memory.set(squad, m);
    }
    return m;
  }

  tick(battle: Battle, dt: number): void {
    for (const squad of battle.squads) {
      if (squad.team !== this.team) continue;
      const m = this.mem(squad);
      if (squad.inMelee) {
        m.meleeSec += dt;
      } else {
        m.meleeSec = 0;
        m.extracting = false;
      }
    }
    this.clock += dt;
    if (this.clock < THINK_INTERVAL) return;
    this.clock = 0;
    this.think(battle);
  }

  private moveIfNew(battle: Battle, squad: Squad, x: number, y: number, facing: number | null = null): void {
    const w = battle.world;
    x = Math.min(w.widthPx - 50, Math.max(50, x));
    y = Math.min(w.heightPx - 50, Math.max(50, y));
    // Never send a squad AT a river/cliff — snap the destination onto dry ground.
    [x, y] = w.nearestOpenPoint(x, y);
    const m = this.mem(squad);
    // Don't spam near-identical orders (each rebuilds a flow field).
    if (squad.hasOrder() && d(m.lastMoveX, m.lastMoveY, x, y) < 70) return;
    if (!squad.hasOrder() && d(squad.anchorX, squad.anchorY, x, y) < 60) return;
    squad.orderMove(x, y, battle.world, facing);
    m.lastMoveX = x;
    m.lastMoveY = y;
  }

  private think(battle: Battle): void {
    const own = battle.squads.filter(
      (s) => s.team === this.team && s.state === 'steady' && s.soldiers.length > 0,
    );
    if (own.length === 0) return;
    const foes = battle.squads.filter((s) => s.team !== this.team && s.soldiers.length > 0);
    const foeSteady = foes.filter((s) => s.state === 'steady');
    // With no standing enemies left, run down whoever is still fleeing.
    const targets = foeSteady.length > 0 ? foeSteady : foes;
    if (targets.length === 0) return;

    // Threat center: strength-weighted centroid of enemy formations.
    let tx = 0;
    let ty = 0;
    let tw = 0;
    for (const f of targets) {
      const w = f.soldiers.length;
      tx += f.anchorX * w;
      ty += f.anchorY * w;
      tw += w;
    }
    tx /= tw;
    ty /= tw;

    const infantry = own.filter((s) => !s.unitType.mounted && !s.unitType.ranged);
    const ranged = own.filter((s) => s.unitType.ranged !== null);
    const cavalry = own.filter((s) => s.unitType.mounted);

    // Advance axis: from our line toward the threat.
    const lineSquads = infantry.length > 0 ? infantry : own;
    let lx = 0;
    let ly = 0;
    for (const s of lineSquads) {
      lx += s.anchorX;
      ly += s.anchorY;
    }
    lx /= lineSquads.length;
    ly /= lineSquads.length;
    const adv = Math.hypot(tx - lx, ty - ly) || 1;
    const dirX = (tx - lx) / adv;
    const dirY = (ty - ly) / adv;
    const perpX = -dirY;
    const perpY = dirX;
    const threatFacing = Math.atan2(dirY, dirX);
    const rearX = lx - dirX * 320;
    const rearY = ly - dirY * 320;

    const nearestTarget = (squad: Squad): Squad => {
      let best = targets[0]!;
      let bestD = Infinity;
      for (const f of targets) {
        const dd = d(squad.anchorX, squad.anchorY, f.anchorX, f.anchorY);
        if (dd < bestD) {
          bestD = dd;
          best = f;
        }
      }
      return best;
    };

    const withdrawIfMauled = (squad: Squad): boolean => {
      if (squad.strengthFraction() >= MAULED_FRACTION || squad.inMelee) return false;
      squad.stance = 'defensive';
      this.moveIfNew(battle, squad, rearX, rearY, threatFacing);
      return true;
    };

    // --- Infantry: advance as a line, engage together ---
    let minProj = Infinity;
    for (const s of infantry) {
      const proj = s.anchorX * dirX + s.anchorY * dirY;
      if (proj < minProj) minProj = proj;
    }
    for (const squad of infantry) {
      if (squad.inMelee) continue;
      if (withdrawIfMauled(squad)) continue;
      const target = nearestTarget(squad);
      const dd = d(squad.anchorX, squad.anchorY, target.anchorX, target.anchorY);
      if (dd < INFANTRY_ENGAGE && target.state === 'steady') {
        if (!squad.isAttacking(target)) squad.orderAttack(target, battle.world);
      } else if (target.state !== 'steady') {
        // Mop-up: chase the fleeing survivors by position.
        const [cx, cy] = soldierCentroid(target);
        this.moveIfNew(battle, squad, cx, cy);
      } else {
        // Hold the line: wait if we've outrun the rearmost squad.
        const proj = squad.anchorX * dirX + squad.anchorY * dirY;
        if (proj - minProj > COHESION_LAG) continue;
        this.moveIfNew(
          battle,
          squad,
          squad.anchorX + dirX * ADVANCE_STEP,
          squad.anchorY + dirY * ADVANCE_STEP,
          threatFacing,
        );
      }
    }

    // --- Ranged: screened firing positions behind the line ---
    ranged.forEach((squad, i) => {
      if (squad.inMelee) return;
      if (withdrawIfMauled(squad)) return;
      const spread = (i - (ranged.length - 1) / 2) * RANGED_SPREAD;
      const threatDist = d(squad.anchorX, squad.anchorY, tx, ty);
      let nearFoe = Infinity;
      for (const f of targets) {
        nearFoe = Math.min(nearFoe, d(squad.anchorX, squad.anchorY, f.anchorX, f.anchorY));
      }
      const backoff = nearFoe < RANGED_PANIC ? RANGED_BACKOFF + 150 : RANGED_BACKOFF;
      // Anchor the screen to the infantry line while it exists; solo otherwise.
      const bx = lx - dirX * backoff + perpX * spread;
      const by = ly - dirY * backoff + perpY * spread;
      // If already comfortably in range and unthreatened, stand and shoot.
      const rp = squad.unitType.ranged!;
      if (nearFoe > RANGED_PANIC && threatDist < rp.range * 0.9 && !squad.hasOrder()) return;
      this.moveIfNew(battle, squad, bx, by, threatFacing);
    });

    // --- Cavalry: hunt, flank, rear-charge, extract ---
    for (const squad of cavalry) {
      const m = this.mem(squad);
      if (squad.inMelee) {
        // Bogged too long: fight clear out the back and reform.
        if (m.meleeSec > CAV_MELEE_LIMIT) m.extracting = true;
        if (m.extracting) {
          squad.orderMove(
            Math.min(battle.world.widthPx - 50, Math.max(50, squad.anchorX - dirX * 380)),
            Math.min(battle.world.heightPx - 50, Math.max(50, squad.anchorY - dirY * 380)),
            battle.world,
          );
        }
        continue;
      }
      m.flanking = null;
      if (withdrawIfMauled(squad)) continue;

      // 1. Ride down routed squads.
      let router: Squad | null = null;
      let routerD = 800;
      for (const f of foes) {
        if (f.state === 'steady') continue;
        const [cx, cy] = soldierCentroid(f);
        const dd = d(squad.anchorX, squad.anchorY, cx, cy);
        if (dd < routerD) {
          routerD = dd;
          router = f;
        }
      }
      if (router) {
        const [cx, cy] = soldierCentroid(router);
        this.moveIfNew(battle, squad, cx, cy);
        continue;
      }

      // 2. Flank-charge exposed ranged squads (no enemy melee squad screening them).
      let exposed: Squad | null = null;
      let exposedD = 900;
      for (const f of foeSteady) {
        if (!f.unitType.ranged) continue;
        const screened = foeSteady.some(
          (g) => g !== f && !g.unitType.ranged && d(g.anchorX, g.anchorY, f.anchorX, f.anchorY) < 260,
        );
        if (screened) continue;
        const dd = d(squad.anchorX, squad.anchorY, f.anchorX, f.anchorY);
        if (dd < exposedD) {
          exposedD = dd;
          exposed = f;
        }
      }
      if (exposed) {
        if (squad.isAttacking(exposed)) {
          if (exposedD < 450 && !squad.charging) squad.startCharge();
        } else if (m.flanking !== exposed || !squad.hasOrder()) {
          squad.orderFlank(exposed, battle.world);
          m.flanking = exposed;
        }
        continue;
      }

      // 3. Rear-charge an enemy squad pinned in melee.
      let pinned: Squad | null = null;
      let pinnedD = 700;
      for (const f of foeSteady) {
        if (!f.inMelee) continue;
        const dd = d(squad.anchorX, squad.anchorY, f.anchorX, f.anchorY);
        if (dd < pinnedD) {
          pinnedD = dd;
          pinned = f;
        }
      }
      if (pinned) {
        if (!squad.isAttacking(pinned)) squad.orderAttack(pinned, battle.world);
        if (pinnedD < 450 && !squad.charging) squad.startCharge();
        continue;
      }

      // 4. Hover on the wing, ready to pounce.
      this.moveIfNew(
        battle,
        squad,
        lx + perpX * m.side * 340 + dirX * 40,
        ly + perpY * m.side * 340 + dirY * 40,
        threatFacing,
      );
    }
  }
}
