import {
  POINTS_NEAR_MISS,
  POINTS_PER_COIN,
  POINTS_PER_METRE,
  STORAGE_KEY,
} from '../core/Config';

/**
 * Distance is the baseline income; coins and near-misses are the skill
 * income. Keeping distance points un-multiplied means a Surge is worth
 * taking risks for without making passive running dominate the board.
 */
export class ScoreSystem {
  score = 0;
  coins = 0;
  distance = 0;
  best = 0;
  multiplier = 1;

  private fractional = 0;

  constructor() {
    this.best = this.loadBest();
  }

  reset(): void {
    this.score = 0;
    this.coins = 0;
    this.distance = 0;
    this.multiplier = 1;
    this.fractional = 0;
  }

  addDistance(metres: number): void {
    this.distance += metres;
    this.fractional += metres * POINTS_PER_METRE;
    const whole = Math.floor(this.fractional);
    if (whole > 0) {
      this.fractional -= whole;
      this.score += whole;
    }
  }

  addCoins(count: number): number {
    this.coins += count;
    const points = count * POINTS_PER_COIN * this.multiplier;
    this.score += points;
    return points;
  }

  addNearMiss(): number {
    const points = POINTS_NEAR_MISS * this.multiplier;
    this.score += points;
    return points;
  }

  /** @returns true when this run beat the stored record. */
  finalise(): boolean {
    const record = this.score > this.best;
    if (record) {
      this.best = this.score;
      try {
        localStorage.setItem(STORAGE_KEY, String(this.best));
      } catch {
        // Private browsing — the run still counts, it just isn't saved.
      }
    }
    return record;
  }

  private loadBest(): number {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const value = raw ? Number.parseInt(raw, 10) : 0;
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }
}
