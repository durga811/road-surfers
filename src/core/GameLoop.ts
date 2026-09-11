/**
 * requestAnimationFrame driver with a clamped delta and a rolling FPS
 * estimate used by the adaptive-quality system.
 */
export class GameLoop {
  private rafId = 0;
  private last = 0;
  private running = false;
  private readonly update: (dt: number, elapsed: number) => void;

  private fpsAccum = 0;
  private fpsFrames = 0;
  /** Smoothed frames-per-second over roughly the last half second. */
  fps = 60;

  elapsed = 0;

  constructor(update: (dt: number, elapsed: number) => void) {
    this.update = update;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.tick(this.last);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    // Clamp: a tab that was backgrounded must not teleport the player
    // through a wall on the first frame back.
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = raw > 0.05 ? 0.05 : raw < 0 ? 0 : raw;

    this.fpsAccum += raw;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.elapsed += dt;
    this.update(dt, this.elapsed);
  };
}
