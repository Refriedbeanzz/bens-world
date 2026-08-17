import { Application, Container, Graphics } from 'pixi.js';
import { startLoop } from './core/loop';
import { Battle } from './sim/battle';
import { formationSpacing, type FormationKind } from './sim/formation';
import type { Squad, Stance } from './sim/squad';
import { Camera } from './render/camera';
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
    background: 0x1a2210,
    antialias: true,
  });
  document.body.appendChild(app.canvas);

  const battle = new Battle(MAP_SEED);
  const world = battle.world;

  const stage = new Container();
  app.stage.addChild(stage);

  stage.addChild(buildTerrainSprite(app.renderer, world));

  const border = new Graphics()
    .rect(0, 0, world.widthPx, world.heightPx)
    .stroke({ width: 6, color: 0x121a0a });
  stage.addChild(border);

  const corpseLayer = new Graphics();
  stage.addChild(corpseLayer);

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

  const selected = new Set<Squad>();
  const camera = new Camera(world, stage, app.canvas, () => selected.size === 0);

  // --- Selection / order state ---
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;
  let boxing = false;
  let rightStart: { x: number; y: number } | null = null;
  let rightNow: { x: number; y: number } | null = null;
  let lineDragging = false;
  let flankMode = false;

  const clampX = (x: number) => Math.min(world.widthPx - 40, Math.max(40, x));
  const clampY = (y: number) => Math.min(world.heightPx - 40, Math.max(40, y));

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
      squad.orderMove(clampX(wx + squad.anchorX - cx), clampY(wy + squad.anchorY - cy), battle.world);
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
    return { sx, sy, L, dirX, dirY, px, py, facing: Math.atan2(py, px) };
  };

  const issueLineOrder = (sw: [number, number], ew: [number, number]): void => {
    if (selected.size === 0) return;
    const g = lineOrderGeometry(sw, ew);
    if (g.L < LINE_ORDER_MIN) {
      issueOrder(...sw);
      return;
    }
    // Squads take segments along the line in their current left-to-right order.
    const order = [...selected].sort(
      (a, b) => (a.anchorX * g.dirX + a.anchorY * g.dirY) - (b.anchorX * g.dirX + b.anchorY * g.dirY),
    );
    const seg = g.L / order.length;
    order.forEach((squad, i) => {
      const along = seg * (i + 0.5);
      const ax = g.sx + g.dirX * along;
      const ay = g.sy + g.dirY * along;
      const spacing = formationSpacing(squad.formation) * (squad.unitType.radius / 7);
      squad.setWidth((seg * 0.92) / spacing);
      squad.orderMove(clampX(ax), clampY(ay), battle.world, g.facing);
    });
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
        squad.orderMove(clampX(squad.anchorX - 340), clampY(squad.anchorY), battle.world, 0);
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

      for (const death of battle.consumeDeaths()) {
        soldierLayer.removeById(death.id);
        if (!death.escaped) {
          corpseLayer
            .ellipse(death.x, death.y, 8, 5)
            .fill({ color: 0x4a1f12, alpha: 0.55 })
            .circle(death.x + 4, death.y + 2, 3)
            .fill({ color: 0x3a1810, alpha: 0.5 });
        }
      }

      soldierLayer.update(battle, alpha);
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

      // Battle-line ghost while right-dragging.
      ghostLayer.clear();
      if (lineDragging && rightStart && rightNow && selected.size > 0) {
        const sw = camera.screenToWorld(rightStart.x, rightStart.y);
        const ew = camera.screenToWorld(rightNow.x, rightNow.y);
        const g = lineOrderGeometry(sw, ew);
        if (g.L >= LINE_ORDER_MIN) {
          ghostLayer
            .moveTo(g.sx, g.sy)
            .lineTo(g.sx + g.dirX * g.L, g.sy + g.dirY * g.L)
            .stroke({ width: 3, color: 0xf0e8c0, alpha: 0.75 });
          // Tick marks where files will stand; arrow showing the facing.
          for (let d = 11; d < g.L; d += 22) {
            ghostLayer
              .circle(g.sx + g.dirX * d, g.sy + g.dirY * d, 3)
              .fill({ color: 0xf0e8c0, alpha: 0.55 });
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
