import { Application, Container, Graphics } from 'pixi.js';
import { startLoop } from './core/loop';
import { World } from './sim/world';
import { Camera } from './render/camera';
import { buildTerrainSprite, buildObstacleLayer } from './render/terrain';

const MAP_SEED = 20260816;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x1a2210,
    antialias: true,
  });
  document.body.appendChild(app.canvas);

  const world = new World(MAP_SEED);

  const stage = new Container();
  app.stage.addChild(stage);

  stage.addChild(buildTerrainSprite(app.renderer, world));

  const border = new Graphics()
    .rect(0, 0, world.widthPx, world.heightPx)
    .stroke({ width: 6, color: 0x121a0a });
  stage.addChild(border);

  stage.addChild(buildObstacleLayer(world));

  const camera = new Camera(world, stage, app.canvas);

  startLoop(
    () => {
      // Sim tick — soldiers, formations, and combat arrive in BW1+.
    },
    (frameDt) => {
      camera.update(frameDt);
    },
  );
}

void boot();
