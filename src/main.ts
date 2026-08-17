import { Application, Container, Graphics } from 'pixi.js';
import { startLoop } from './core/loop';
import { Battle } from './sim/battle';
import type { FormationKind } from './sim/formation';
import type { Squad } from './sim/squad';
import type { Stance } from './sim/squad';
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

const DRAG_THRESHOLD = 8; // px of mouse travel before a click becomes a box-select

const STANCE_KEYS: Record<string, Stance> = {
  z: 'defensive',
  x: 'balanced',
  c: 'offensive',
};

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

  // Corpse stains accumulate under everything else that moves.
  const corpseLayer = new Graphics();
  stage.addChild(corpseLayer);

  // Selection rings draw under the soldiers.
  const selectionLayer = new Graphics();
  stage.addChild(selectionLayer);

  const soldierLayer = new SoldierLayer(app.renderer, battle);
  stage.addChild(soldierLayer.container);

  const projectileLayer = new Graphics();
  stage.addChild(projectileLayer);

  // Trees/rocks draw above soldiers so troops pass "under" the canopy.
  stage.addChild(buildObstacleLayer(world));

  const orderMarker = new Graphics();
  stage.addChild(orderMarker);
  let markerAge = Infinity;
  let markerColor = 0xf0e8c0;

  // Screen-space UI (the box-select rectangle) sits above the world.
  const uiLayer = new Graphics();
  app.stage.addChild(uiLayer);

  const camera = new Camera(world, stage, app.canvas);

  // --- Standard RTS controls (until BW5's real UI) ---
  // LEFT: select — click a squad, drag a box for several, Ctrl adds, empty ground clears.
  // RIGHT: order — click ground to move, click an enemy to attack (a longer
  //        right-drag still pans the camera). Shift: charge. Ctrl+A: select all.
  const selected = new Set<Squad>();
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;
  let boxing = false;
  let rightStart: { x: number; y: number } | null = null;

  const issueOrder = (wx: number, wy: number): void => {
    if (selected.size === 0) return;
    const enemy = battle.enemySquadAt(wx, wy);
    if (enemy) {
      for (const squad of selected) squad.orderAttack(enemy, battle.world);
      markerColor = 0xe05050;
    } else {
      // Group move: keep the squads' relative spacing around the clicked point.
      let cx = 0;
      let cy = 0;
      for (const squad of selected) {
        cx += squad.anchorX;
        cy += squad.anchorY;
      }
      cx /= selected.size;
      cy /= selected.size;
      for (const squad of selected) {
        const tx = Math.min(world.widthPx - 40, Math.max(40, wx + squad.anchorX - cx));
        const ty = Math.min(world.heightPx - 40, Math.max(40, wy + squad.anchorY - cy));
        squad.orderMove(tx, ty, battle.world);
      }
      markerColor = 0xf0e8c0;
    }
    markerAge = 0;
    orderMarker.position.set(wx, wy);
  };

  app.canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      dragStart = { x: e.clientX, y: e.clientY };
      dragNow = dragStart;
      boxing = false;
    } else if (e.button === 2) {
      rightStart = { x: e.clientX, y: e.clientY };
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    dragNow = { x: e.clientX, y: e.clientY };
    if (!boxing) {
      const moved = Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y);
      if (moved > DRAG_THRESHOLD) boxing = true;
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button === 2 && rightStart) {
      // Right-click (barely moved) orders; a real drag was a camera pan.
      const moved = Math.hypot(e.clientX - rightStart.x, e.clientY - rightStart.y);
      rightStart = null;
      if (moved <= DRAG_THRESHOLD) {
        const [wx, wy] = camera.screenToWorld(e.clientX, e.clientY);
        issueOrder(wx, wy);
      }
      return;
    }
    if (e.button !== 0 || !dragStart) return;

    if (boxing && dragNow) {
      // Box-select: every player squad with a soldier inside the box.
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
      }
    }
    dragStart = null;
    dragNow = null;
    boxing = false;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      selected.clear();
      return;
    }
    if (e.key === 'Shift') {
      for (const squad of selected) squad.startCharge();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selected.clear();
      for (const squad of battle.squads) {
        if (squad.team === 0 && squad.state === 'steady') selected.add(squad);
      }
      return;
    }
    const stance = STANCE_KEYS[e.key.toLowerCase()];
    if (stance && !e.ctrlKey) {
      for (const squad of selected) squad.stance = stance;
      return;
    }
    const kind = FORMATION_KEYS[e.key];
    if (kind) for (const squad of selected) squad.setFormation(kind);
  });

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

      // Dead or broken squads can't be commanded — drop them from the selection.
      for (const squad of [...selected]) {
        if (squad.soldiers.length === 0 || squad.state !== 'steady') selected.delete(squad);
      }

      selectionLayer.clear();
      for (const squad of selected) {
        const color = squad.charging ? 0xf0a030 : 0xf0d878;
        for (const s of squad.soldiers) {
          selectionLayer
            .circle(s.prevX + (s.x - s.prevX) * alpha, s.prevY + (s.y - s.prevY) * alpha, 10)
            .stroke({ width: 2, color, alpha: 0.85 });
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
    },
  );
}

void boot();
