import {
  SPEED_MAX,
  SPEED_RAMP_TIME,
  SPEED_START,
  TIER_DISTANCE,
} from '../core/Config';
import { clamp } from '../core/MathUtils';

/**
 * Difficulty is a function of elapsed time (speed) and distance (tier),
 * never of randomness. The curve is deliberately front-loaded slow: the
 * first ~20 seconds are teaching time, and the ramp flattens near the
 * top so the ceiling is a plateau you can master rather than a wall.
 */
export class DifficultyManager {
  private elapsed = 0;
  private distance = 0;
  private surgeBonus = 0;

  speed = SPEED_START;
  tier = 0;

  reset(): void {
    this.elapsed = 0;
    this.distance = 0;
    this.surgeBonus = 0;
    this.speed = SPEED_START;
    this.tier = 0;
  }

  update(dt: number, distance: number, surgeActive: boolean, surgeSpeed: number): void {
    this.elapsed += dt;
    this.distance = distance;

    // Ease-out ramp: fast early gains, gentle approach to the ceiling.
    const t = clamp(this.elapsed / SPEED_RAMP_TIME, 0, 1);
    const eased = 1 - Math.pow(1 - t, 2.1);
    const base = SPEED_START + (SPEED_MAX - SPEED_START) * eased;

    // Surge blends in and out rather than snapping, so the camera FOV
    // and the audio pitch have something continuous to follow.
    const target = surgeActive ? surgeSpeed : 0;
    this.surgeBonus += (target - this.surgeBonus) * Math.min(1, dt * 3.2);
    this.speed = base + this.surgeBonus;

    let tier = 0;
    for (let i = TIER_DISTANCE.length - 1; i >= 0; i--) {
      if (this.distance >= TIER_DISTANCE[i]) { tier = i; break; }
    }
    this.tier = tier;
  }

  /** 0 → starting speed, 1 → maximum. Drives the HUD gauge and FOV. */
  get intensity(): number {
    return clamp((this.speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
  }
}
