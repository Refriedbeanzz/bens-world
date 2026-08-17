import { Application, Container, Graphics, TilingSprite } from 'pixi.js';
import { startLoop } from './core/loop';
import { Battle } from './sim/battle';
import { MAPS } from './sim/maps';
import { formationSpacing, layoutSlots, type FormationKind } from './sim/formation';
import type { Squad, Stance } from './sim/squad';
import { Camera } from './render/camera';
import { GoreLayer } from './render/gore';
import { buildGrainTexture } from './render/grain';
import { drawProjectiles, SoldierLayer } from './render/soldiers';
import { buildTerrainSprite, buildObstacleLayer } from './render/terrain';

const MAP_SEED = 20260816;

const FORMATION_KEYS: Record<string, FormationKind> = {
  '1': 'line',
  '2': 'column',
  '3': 'wedge',
  '4': 'square',
  '5': 'wall',
  '6': 'loose',
  '7': 'circle',
};

const STANCE_KEYS: Record<string, Stance> = {
  z: 'defensive',
  x: 'balanced',
  c: 'offensive',
};

const DRAG_THRESHOLD = 8; // px of mouse travel before a click becomes a drag gesture
const LINE_ORDER_MIN = 40; // world px of right-drag before it counts as a battle line

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x11170b,
    antialias: true,
  });
  document.body.appendChild(app.canvas);

  // Map selection via ?map= query param; the HUD dropdown reloads with it.
  const requested = new URLSearchParams(location.search).get('map') ?? 'meadow';
  const mapKey = MAPS[requested] ? requested : 'meadow';
  const battle = new Battle(MAP_SEED, undefined, { map: MAPS[mapKey]!.spec });
  const world = battle.world;

  const mapSelect = document.getElementById('mapsel') as HTMLSelectElement;
  for (const [key, def] of Object.entries(MAPS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = def.name;
    opt.selected = key === mapKey;
    mapSelect.appendChild(opt);
  }
  mapSelect.addEventListener('change', () => {
    location.href = `?map=${mapSelect.value}`;
  });

  const stage = new Container();
  app.stage.addChild(stage);

  stage.addChild(buildTerrainSprite(app.renderer, world));

  const border = new Graphics()
    .rect(0, 0, world.widthPx, world.heightPx)
    .stroke({ width: 6, color: 0x121a0a });
  stage.addChild(border);

  const gore = new GoreLayer(app.renderer, world.widthPx, world.heightPx);
  stage.addChild(gore.container);

  const selectionLayer = new Graphics();
  stage.addChild(selectionLayer);

  const soldierLayer = new SoldierLayer(app.renderer, battle);
  stage.addChild(soldierLayer.container);

  const projectileLayer = new Graphics();
  stage.addChild(projectileLayer);

  stage.addChild(buildObstacleLayer(world));

  // Ghost preview of a dragged battle line, in world space.
  const ghostLayer = new Graphics();
  stage.addChild(ghostLayer);

  const orderMarker = new Graphics();
  stage.addChild(orderMarker);
  let markerAge = Infinity;
  let markerColor = 0xf0e8c0;

  // Screen-space UI (the box-select rectangle).
  const uiLayer = new Graphics();
  app.stage.addChild(uiLayer);

  // Film grain: a fixed screen-space multiply overlay tying terrain, soldiers,
  // and gore into one gritty texture instead of reading as separate layers.
  const grainTex = buildGrainTexture(app.renderer);
  const grain = new TilingSprite({ texture: grainTex, width: window.innerWidth, height: window.innerHeight });
  grain.blendMode = 'multiply';
  grain.alpha = 0.24;
  app.stage.addChild(grain);

  const selected = new Set<Squad>();
  const camera = new Camera(world, stage, app.canvas, () => selected.size === 0);

  // --- Selection / order state ---
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;
  let boxing = false;
  let rightStart: { x: number; y: number } | null = null;
  let rightNow: { x: number; y: number } | null = null;
  let lineDragging = false;
  let lineFlip = false; // Tab while dragging flips which way the line faces
  let flankMode = false;

  const clampX = (x: number) => Math.min(world.widthPx - 40, Math.max(40, x));
  const clampY = (y: number) => Math.min(world.heightPx - 40, Math.max(40, y));
  // Never send a squad AT a river/cliff — an order aimed at solid terrain
  // leaves it pressed against the bank forever instead of arriving.
  const clampOpen = (x: number, y: number): [number, number] => world.nearestOpenPoint(clampX(x), clampY(y));

  const showMarker = (wx: number, wy: number, color: number): void => {
    markerColor = color;
    markerAge = 0;
    orderMarker.position.set(wx, wy);
  };

  // Simple right-click: attack what's under the cursor, flank it in flank mode,
  // or group-move preserving relative spacing.
  const issueOrder = (wx: number, wy: number): void => {
    if (selected.size === 0) return;
    const enemy = battle.enemySquadAt(wx, wy);
    if (enemy) {
      for (const squad of selected) {
        if (flankMode) squad.orderFlank(enemy, battle.world);
        else squad.orderAttack(enemy, battle.world);
      }
      showMarker(wx, wy, flankMode ? 0xf0a030 : 0xe05050);
      flankMode = false;
      return;
    }
    let cx = 0;
    let cy = 0;
    for (const squad of selected) {
      cx += squad.anchorX;
      cy += squad.anchorY;
    }
    cx /= selected.size;
    cy /= selected.size;
    for (const squad of selected) {
      const [tx, ty] = clampOpen(wx + squad.anchorX - cx, wy + squad.anchorY - cy);
      squad.orderMove(tx, ty, battle.world);
    }
    showMarker(wx, wy, 0xf0e8c0);
  };

  // Battle-line geometry shared by the ghost preview and the real order.
  const lineOrderGeometry = (sw: [number, number], ew: [number, number]) => {
    const [sx, sy] = sw;
    const [ex, ey] = ew;
    const L = Math.hypot(ex - sx, ey - sy);
    const dirX = (ex - sx) / (L || 1);
    const dirY = (ey - sy) / (L || 1);
    // Face perpendicular to the drawn line, away from where the squads stand now.
    let cx = 0;
    let cy = 0;
    for (const squad of selected) {
      cx += squad.anchorX;
      cy += squad.anchorY;
    }
    cx /= selected.size || 1;
    cy /= selected.size || 1;
    let px = -dirY;
    let py = dirX;
    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    if (px * (midX - cx) + py * (midY - cy) < 0) {
      px = -px;
      py = -py;
    }
    if (lineFlip) {
      px = -px;
      py = -py;
    }
    return { sx, sy, L, dirX, dirY, px, py, facing: Math.atan2(py, px) };
  };

  // The full plan for a dragged battle line: where each squad's anchor lands and
  // how wide it forms. Shared by the ghost preview and the real order, so the
  // preview IS the order.
  const planLineOrder = (sw: [number, number], ew: [number, number]) => {
    const g = lineOrderGeometry(sw, ew);
    if (g.L < LINE_ORDER_MIN || selected.size === 0) return null;
    const order = [...selected].sort(
      (a, b) => (a.anchorX * g.dirX + a.anchorY * g.dirY) - (b.anchorX * g.dirX + b.anchorY * g.dirY),
    );
    const seg = g.L / order.length;
    const placements = order.map((squad, i) => {
      const along = seg * (i + 0.5);
      const spacing = formationSpacing(squad.formation) * (squad.unitType.radius / 7);
      const cols = Math.min(squad.soldiers.length, Math.max(2, Math.round((seg * 0.92) / spacing)));
      const [ax, ay] = clampOpen(g.sx + g.dirX * along, g.sy + g.dirY * along);
      return { squad, ax, ay, cols };
    });
    return { g, placements };
  };

  const issueLineOrder = (sw: [number, number], ew: [number, number]): void => {
    const plan = planLineOrder(sw, ew);
    if (!plan) {
      issueOrder(...sw);
      return;
    }
    for (const p of plan.placements) {
      p.squad.setWidth(p.cols);
      p.squad.orderMove(p.ax, p.ay, battle.world, plan.g.facing);
    }
    const { g } = plan;
    showMarker(g.sx + (g.dirX * g.L) / 2, g.sy + (g.dirY * g.L) / 2, 0xf0e8c0);
  };

  app.canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      dragStart = { x: e.clientX, y: e.clientY };
      dragNow = dragStart;
      boxing = false;
    } else if (e.button === 2) {
      rightStart = { x: e.clientX, y: e.clientY };
      rightNow = rightStart;
      lineDragging = false;
      lineFlip = false;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (dragStart) {
      dragNow = { x: e.clientX, y: e.clientY };
      if (!boxing && Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y) > DRAG_THRESHOLD) {
        boxing = true;
      }
    }
    if (rightStart && selected.size > 0) {
      rightNow = { x: e.clientX, y: e.clientY };
      if (!lineDragging && Math.hypot(rightNow.x - rightStart.x, rightNow.y - rightStart.y) > DRAG_THRESHOLD) {
        lineDragging = true;
      }
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 2 && rightStart) {
      const start = rightStart;
      const now = { x: e.clientX, y: e.clientY };
      rightStart = null;
      rightNow = null;
      if (selected.size === 0) return; // was a camera pan
      if (lineDragging) {
        lineDragging = false;
        issueLineOrder(camera.screenToWorld(start.x, start.y), camera.screenToWorld(now.x, now.y));
      } else {
        const [wx, wy] = camera.screenToWorld(now.x, now.y);
        issueOrder(wx, wy);
      }
      return;
    }
    if (e.button !== 0 || !dragStart) return;

    if (boxing && dragNow) {
      const [ax, ay] = camera.screenToWorld(dragStart.x, dragStart.y);
      const [bx, by] = camera.screenToWorld(dragNow.x, dragNow.y);
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      if (!e.ctrlKey) selected.clear();
      for (const squad of battle.squads) {
        if (squad.team !== 0 || squad.state !== 'steady') continue;
        const inside = squad.soldiers.some(
          (s) => s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY,
        );
        if (inside) selected.add(squad);
      }
    } else {
      const [wx, wy] = camera.screenToWorld(e.clientX, e.clientY);
      const own = battle.playerSquadAt(wx, wy);
      if (own) {
        if (e.ctrlKey) {
          if (selected.has(own)) selected.delete(own);
          else selected.add(own);
        } else {
          selected.clear();
          selected.add(own);
        }
      } else {
        selected.clear();
        flankMode = false;
      }
    }
    dragStart = null;
    dragNow = null;
    boxing = false;
  });

  const commands = {
    charge: () => {
      for (const squad of selected) squad.startCharge();
    },
    halt: () => {
      for (const squad of selected) squad.halt();
    },
    retreat: () => {
      for (const squad of selected) {
        squad.stance = 'defensive';
        const [tx, ty] = clampOpen(squad.anchorX - 340, squad.anchorY);
        squad.orderMove(tx, ty, battle.world, 0);
      }
    },
    flank: () => {
      if (selected.size > 0) flankMode = !flankMode;
    },
    formation: (kind: FormationKind) => {
      for (const squad of selected) squad.setFormation(kind);
    },
    stance: (st: Stance) => {
      for (const squad of selected) squad.stance = st;
    },
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && lineDragging) {
      e.preventDefault();
      lineFlip = !lineFlip;
      return;
    }
    if (e.key === 'Escape') {
      selected.clear();
      flankMode = false;
      return;
    }
    if (e.key === 'Shift') return commands.charge();
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selected.clear();
      for (const squad of battle.squads) {
        if (squad.team === 0 && squad.state === 'steady') selected.add(squad);
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'h') return commands.halt();
    if (k === 'r') return commands.retreat();
    if (k === 'f') return commands.flank();
    const stance = STANCE_KEYS[k];
    if (stance && !e.ctrlKey) return commands.stance(stance);
    const kind = FORMATION_KEYS[e.key];
    if (kind) commands.formation(kind);
  });

  // --- Squad panel (DOM) ---
  const panel = document.getElementById('panel')!;
  const cardsBox = document.createElement('div');
  cardsBox.className = 'cards';
  const buttonsBox = document.createElement('div');
  buttonsBox.className = 'buttons';
  panel.append(cardsBox, buttonsBox);

  const mkBtn = (label: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      fn();
    });
    buttonsBox.appendChild(b);
    return b;
  };

  (Object.entries(FORMATION_KEYS) as [string, FormationKind][]).forEach(([key, kind]) =>
    mkBtn(kind, `formation (${key})`, () => commands.formation(kind)),
  );
  mkBtn('def', 'defensive stance (z)', () => commands.stance('defensive'));
  mkBtn('bal', 'balanced stance (x)', () => commands.stance('balanced'));
  mkBtn('off', 'offensive stance (c)', () => commands.stance('offensive'));
  mkBtn('CHARGE', 'charge (Shift)', commands.charge);
  mkBtn('HALT', 'stand fast (H)', commands.halt);
  mkBtn('RETREAT', 'fall back defensively (R)', commands.retreat);
  const flankBtn = mkBtn('FLANK', 'then right-click an enemy (F)', commands.flank);

  const cards = new Map<Squad, { root: HTMLDivElement; info: HTMLDivElement }>();
  for (const squad of battle.squads) {
    if (squad.team !== 0) continue;
    const root = document.createElement('div');
    root.className = 'card';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = squad.unitType.name;
    const info = document.createElement('div');
    info.className = 'info';
    root.append(name, info);
    root.addEventListener('click', (ev) => {
      if (squad.state !== 'steady' || squad.soldiers.length === 0) return;
      if (ev.ctrlKey) {
        if (selected.has(squad)) selected.delete(squad);
        else selected.add(squad);
      } else {
        selected.clear();
        selected.add(squad);
      }
    });
    cardsBox.appendChild(root);
    cards.set(squad, { root, info });
  }

  const initialCounts = new Map<Squad, number>();
  for (const squad of battle.squads) initialCounts.set(squad, squad.soldiers.length);

  let panelClock = 0;
  const updatePanel = (): void => {
    for (const [squad, el] of cards) {
      const n = squad.soldiers.length;
      const state =
        n === 0
          ? 'dead'
          : squad.state !== 'steady'
            ? squad.state
            : squad.charging
              ? 'charging'
              : squad.inMelee
                ? 'fighting'
                : 'ready';
      el.info.textContent = `${n}/${initialCounts.get(squad)} · ${squad.formation} · ${squad.stance} · ${state}`;
      el.root.classList.toggle('sel', selected.has(squad));
      el.root.classList.toggle('gone', n === 0 || squad.state === 'fleeing');
      el.root.classList.toggle('hurt', squad.state === 'routing');
    }
    flankBtn.classList.toggle('active', flankMode);
  };

  startLoop(
    (dt) => {
      battle.tick(dt);
    },
    (frameDt, alpha) => {
      camera.update(frameDt);
      grain.width = window.innerWidth;
      grain.height = window.innerHeight;

      for (const death of battle.consumeDeaths()) {
        soldierLayer.removeById(death.id);
        // Escaped (routed off-map) soldiers just leave; killed ones stagger and fall.
        if (!death.escaped) soldierLayer.playDeath(app.renderer, death);
      }

      soldierLayer.update(battle, alpha, frameDt, gore);
      gore.update(frameDt);
      drawProjectiles(projectileLayer, battle, alpha);

      for (const squad of [...selected]) {
        if (squad.soldiers.length === 0 || squad.state !== 'steady') selected.delete(squad);
      }
      if (selected.size === 0) flankMode = false;

      selectionLayer.clear();
      for (const squad of selected) {
        const color = squad.charging ? 0xf0a030 : 0xf0d878;
        for (const s of squad.soldiers) {
          selectionLayer
            .circle(s.prevX + (s.x - s.prevX) * alpha, s.prevY + (s.y - s.prevY) * alpha, s.radius + 3)
            .stroke({ width: 2, color, alpha: 0.85 });
        }
      }

      // Battle-line ghost while right-dragging: one dot per soldier, exactly
      // where he will stand (same math as the real order), plus a facing arrow.
      ghostLayer.clear();
      if (lineDragging && rightStart && rightNow && selected.size > 0) {
        const sw = camera.screenToWorld(rightStart.x, rightStart.y);
        const ew = camera.screenToWorld(rightNow.x, rightNow.y);
        const plan = planLineOrder(sw, ew);
        if (plan) {
          const { g } = plan;
          const fx = Math.cos(g.facing);
          const fy = Math.sin(g.facing);
          const rx = -fy;
          const ry = fx;
          for (const p of plan.placements) {
            const slots = layoutSlots(
              p.squad.formation,
              p.squad.soldiers.length,
              p.squad.unitType.radius / 7,
              p.cols,
            );
            for (const slot of slots) {
              ghostLayer
                .circle(
                  p.ax + rx * slot.lateral - fx * slot.depth,
                  p.ay + ry * slot.lateral - fy * slot.depth,
                  p.squad.unitType.radius * 0.75,
                )
                .fill({ color: 0xf0e8c0, alpha: 0.3 });
            }
          }
          const mx = g.sx + (g.dirX * g.L) / 2;
          const my = g.sy + (g.dirY * g.L) / 2;
          ghostLayer
            .moveTo(mx, my)
            .lineTo(mx + g.px * 34, my + g.py * 34)
            .stroke({ width: 3, color: 0xf0e8c0, alpha: 0.9 })
            .poly([
              mx + g.px * 44, my + g.py * 44,
              mx + g.px * 30 - g.dirX * 7, my + g.py * 30 - g.dirY * 7,
              mx + g.px * 30 + g.dirX * 7, my + g.py * 30 + g.dirY * 7,
            ])
            .fill({ color: 0xf0e8c0, alpha: 0.9 });
        }
      }

      uiLayer.clear();
      if (boxing && dragStart && dragNow) {
        uiLayer
          .rect(
            Math.min(dragStart.x, dragNow.x),
            Math.min(dragStart.y, dragNow.y),
            Math.abs(dragNow.x - dragStart.x),
            Math.abs(dragNow.y - dragStart.y),
          )
          .fill({ color: 0xf0d878, alpha: 0.08 })
          .stroke({ width: 1.5, color: 0xf0d878, alpha: 0.7 });
      }

      markerAge += frameDt;
      orderMarker.clear();
      if (markerAge < 0.9) {
        const t = markerAge / 0.9;
        orderMarker
          .circle(0, 0, 10 + t * 18)
          .stroke({ width: 3, color: markerColor, alpha: 1 - t });
      }

      panelClock += frameDt;
      if (panelClock > 0.15) {
        panelClock = 0;
        updatePanel();
      }
    },
  );
}

void boot();
