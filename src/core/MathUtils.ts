export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing. `speed` ≈ 1/τ. */
export const damp = (a: number, b: number, speed: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-speed * dt));

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
