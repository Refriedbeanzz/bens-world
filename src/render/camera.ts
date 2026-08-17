import type { Container } from 'pixi.js';
import type { World } from '../sim/world';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const PAN_SPEED = 900; // world px per second at zoom 1

export class Camera {
  x: number;
  y: number;
  zoom = 0.55;

  private keys = new Set<string>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    private readonly world: World,
    private readonly stage: Container,
    canvas: HTMLCanvasElement,
    // Right-drag pans only when this allows it (with squads selected, right-drag
    // draws a battle line instead). Middle-drag always pans.
    private readonly canRightPan: () => boolean = () => true,
  ) {
    this.x = world.widthPx / 2;
    this.y = world.heightPx / 2;

    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 2 && this.canRightPan())) {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.x -= (e.clientX - this.lastPointer.x) / this.zoom;
      this.y -= (e.clientY - this.lastPointer.y) / this.zoom;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
        // Zoom toward the cursor: keep the world point under the pointer fixed on screen.
        const worldX = this.x + (e.clientX - window.innerWidth / 2) / this.zoom;
        const worldY = this.y + (e.clientY - window.innerHeight / 2) / this.zoom;
        this.zoom = newZoom;
        this.x = worldX - (e.clientX - window.innerWidth / 2) / this.zoom;
        this.y = worldY - (e.clientY - window.innerHeight / 2) / this.zoom;
      },
      { passive: false },
    );
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [
      this.x + (sx - window.innerWidth / 2) / this.zoom,
      this.y + (sy - window.innerHeight / 2) / this.zoom,
    ];
  }

  update(dtSeconds: number): void {
    const speed = (PAN_SPEED / this.zoom) * dtSeconds;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.y -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.y += speed;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.x -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.x += speed;

    const margin = 200;
    this.x = Math.min(this.world.widthPx + margin, Math.max(-margin, this.x));
    this.y = Math.min(this.world.heightPx + margin, Math.max(-margin, this.y));

    this.stage.scale.set(this.zoom);
    this.stage.position.set(
      window.innerWidth / 2 - this.x * this.zoom,
      window.innerHeight / 2 - this.y * this.zoom,
    );
  }
}
