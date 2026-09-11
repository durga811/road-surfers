import {
  MAGNET_DURATION,
  SHIELD_DURATION,
  SURGE_DURATION,
  SURGE_MULTIPLIER,
  SURGE_SPEED_BONUS,
} from '../core/Config';
import { PowerUpKind } from '../world/ProceduralGenerator';

export interface ActivePowerUp {
  kind: PowerUpKind;
  remaining: number;
  duration: number;
}

const DURATIONS: Record<PowerUpKind, number> = {
  magnet: MAGNET_DURATION,
  shield: SHIELD_DURATION,
  surge: SURGE_DURATION,
};

export const POWER_LABEL: Record<PowerUpKind, string> = {
  magnet: 'Magnet',
  shield: 'Shield',
  surge: 'Surge',
};

export const POWER_CSS: Record<PowerUpKind, string> = {
  magnet: '#ff5cf0',
  shield: '#4de3ff',
  surge: '#8affd6',
};

/**
 * Timed modifiers. Shield is the only one that is consumed by an event
 * rather than by time — it turns one fatal mistake into a stumble,
 * which is what keeps long runs from ending on a single misread.
 */
export class PowerUpSystem {
  readonly active: ActivePowerUp[] = [];

  reset(): void {
    this.active.length = 0;
  }

  activate(kind: PowerUpKind): void {
    const existing = this.active.find((p) => p.kind === kind);
    const duration = DURATIONS[kind];
    if (existing) {
      existing.remaining = duration;   // refresh rather than stack
      existing.duration = duration;
      return;
    }
    this.active.push({ kind, remaining: duration, duration });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      this.active[i].remaining -= dt;
      if (this.active[i].remaining <= 0) this.active.splice(i, 1);
    }
  }

  has(kind: PowerUpKind): boolean {
    return this.active.some((p) => p.kind === kind);
  }

  /** Consumes the shield. @returns true if a hit was absorbed. */
  consumeShield(): boolean {
    const index = this.active.findIndex((p) => p.kind === 'shield');
    if (index === -1) return false;
    this.active.splice(index, 1);
    return true;
  }

  get magnet(): boolean { return this.has('magnet'); }
  get surge(): boolean { return this.has('surge'); }
  get surgeSpeed(): number { return SURGE_SPEED_BONUS; }
  get scoreMultiplier(): number { return this.surge ? SURGE_MULTIPLIER : 1; }
}
