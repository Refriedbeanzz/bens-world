import { Application, Container, Graphics } from 'pixi.js';
import { startLoop } from './core/loop';
import { Battle } from './sim/battle';
import type { FormationKind } from './sim/formation';
import type { Squad } from './sim/squad';
import { Camera } from './render/camera';
import { SoldierLayer } from './render/soldiers';
import { buildTerrainSprite, buildObstacleLayer } from './render/terrain';

const MAP_SEED = 20260816;

const FORMATION_KEYS: Record<string, FormationKind> = {
  '1': 'line',
  '2': 'column',
  '3': 'wedge',
  '4': 'square',
  '5': 'wall',
  '6': 'loose',
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

  // Selection rings draw under the soldiers.
  const selectionLayer = new Graphics();
  stage.addChild(selectionLayer);

  const soldierLayer = new SoldierLayer(app.renderer, battle);
  stage.addChild(soldierLayer.container);

  // Trees/rocks draw above soldiers so troops pass "under" the canopy.
  stage.addChild(buildObstacleLayer(world));

  const orderMarker = new Graphics();
  stage.addChild(orderMarker);
  let markerAge = Infinity;

  const camera = new Camera(world, stage, app.canvas);

  // Bannerlord-style test control (until BW5's real UI):
  // click one of your squads to select it, then click ground to march it there.
  let selected: Squad | null = null;

  app.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [wx, wy] = camera.screenToWorld(e.clientX, e.clientY);

    const clicked = battle.playerSquadAt(wx, wy);
    if (clicked) {
      selected = clicked;
      return;
    }
    if (selected) {
      selected.orderMove(wx, wy);
      markerAge = 0;
      orderMarker.position.set(wx, wy);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      selected = null;
      return;
    }
    const kind = FORMATION_KEYS[e.key];
    if (kind && selected) selected.setFormation(kind);
  });

  startLoop(
    (dt) => {
      battle.tick(dt);
    },
    (frameDt, alpha) => {
      camera.update(frameDt);
      soldierLayer.update(battle, alpha);

      selectionLayer.clear();
      if (selected) {
        for (const s of selected.soldiers) {
          selectionLayer
            .circle(s.prevX + (s.x - s.prevX) * alpha, s.prevY + (s.y - s.prevY) * alpha, 10)
            .stroke({ width: 2, color: 0xf0d878, alpha: 0.85 });
        }
      }

      markerAge += frameDt;
      orderMarker.clear();
      if (markerAge < 0.9) {
        const t = markerAge / 0.9;
        orderMarker
          .circle(0, 0, 10 + t * 18)
          .stroke({ width: 3, color: 0xf0e8c0, alpha: 1 - t });
      }
    },
  );
}

void boot();
