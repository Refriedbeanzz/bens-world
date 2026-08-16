import { Application, Container, Graphics } from 'pixi.js';
import { startLoop } from './core/loop';
import { Battle } from './sim/battle';
import type { FormationKind } from './sim/formation';
import { Camera } from './render/camera';
import { SoldierLayer } from './render/soldiers';
import { buildTerrainSprite, buildObstacleLayer } from './render/terrain';

const MAP_SEED = 20260816;

const FORMATION_KEYS: Record<string, FormationKind> = {
  '1': 'line',
  '2': 'column',
  '3': 'wedge',
  '4': 'square',
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

  const soldierLayer = new SoldierLayer(app.renderer, battle);
  stage.addChild(soldierLayer.container);

  // Trees/rocks draw above soldiers so troops pass "under" the canopy.
  stage.addChild(buildObstacleLayer(world));

  const orderMarker = new Graphics();
  stage.addChild(orderMarker);
  let markerAge = Infinity;

  const camera = new Camera(world, stage, app.canvas);

  // Test command (until BW5's real UI): left-click marches the blue squad there.
  app.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [wx, wy] = camera.screenToWorld(e.clientX, e.clientY);
    battle.playerSquad.orderMove(wx, wy);
    markerAge = 0;
    orderMarker.position.set(wx, wy);
  });

  window.addEventListener('keydown', (e) => {
    const kind = FORMATION_KEYS[e.key];
    if (kind) battle.playerSquad.setFormation(kind);
  });

  startLoop(
    (dt) => {
      battle.tick(dt);
    },
    (frameDt, alpha) => {
      camera.update(frameDt);
      soldierLayer.update(battle, alpha);

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
