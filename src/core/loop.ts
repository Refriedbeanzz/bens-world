// Fixed-timestep game loop: the simulation always advances in identical 1/30s ticks
// regardless of frame rate, so battles are reproducible. Rendering runs every frame.
export const SIM_DT = 1 / 30;
const MAX_FRAME_TIME = 0.25;

export function startLoop(
  simTick: (dt: number) => void,
  render: (frameDt: number, alpha: number) => void,
): void {
  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number) => {
    let frameDt = (now - last) / 1000;
    last = now;
    if (frameDt > MAX_FRAME_TIME) frameDt = MAX_FRAME_TIME;

    accumulator += frameDt;
    while (accumulator >= SIM_DT) {
      simTick(SIM_DT);
      accumulator -= SIM_DT;
    }

    // alpha = how far we are between sim ticks; rendering interpolates with it.
    render(frameDt, accumulator / SIM_DT);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
