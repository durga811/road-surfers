import {
  COYOTE_TIME,
  FAST_FALL_GRAVITY,
  GRAVITY,
  JUMP_VELOCITY,
  LANE_CHANGE_TIME,
  LANE_COUNT,
  LANE_WIDTH,
  LANE_X,
  SLIDE_TIME,
} from '../core/Config';
import { clamp, easeOutCubic } from '../core/MathUtils';
import { Action, ActionSource } from '../input/InputManager';

export interface MovementEvents {
  onJump?: () => void;
  onLand?: (impact: number) => void;
  onSlide?: () => void;
  onLaneChange?: (direction: number) => void;
}

/**
 * Pure kinematics + posture state machine. Holds no Three.js objects,
 * which keeps it trivially testable and keeps rendering concerns out of
 * the gameplay rules.
 */
export class PlayerMovement {
  x = 0;
  y = 0;
  verticalVelocity = 0;
  lateralVelocity = 0;

  lane = 1;
  grounded = true;
  sliding = false;

  /** 0 → planted, 1 → fully airborne. Drives the model blend. */
  airBlend = 0;
  slideBlend = 0;

  private laneStartX = 0;
  private laneElapsed = 0;
  private laneDuration = LANE_CHANGE_TIME;
  private slideTimer = 0;
  private coyote = 0;
  private queuedSlide = false;

  constructor(private readonly events: MovementEvents = {}) {}

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.verticalVelocity = 0;
    this.lateralVelocity = 0;
    this.lane = 1;
    this.grounded = true;
    this.sliding = false;
    this.airBlend = 0;
    this.slideBlend = 0;
    this.laneStartX = 0;
    this.laneElapsed = this.laneDuration;
    this.slideTimer = 0;
    this.coyote = 0;
    this.queuedSlide = false;
  }

  update(dt: number, input: ActionSource, controllable: boolean): void {
    if (controllable) this.readInput(input);

    this.integrateVertical(dt);
    this.integrateLateral(dt);
    this.integrateSlide(dt);
  }

  // ── Input ─────────────────────────────────────────────────────────
  private readInput(input: ActionSource): void {
    if (input.consume(Action.Left)) this.moveLane(-1);
    if (input.consume(Action.Right)) this.moveLane(1);

    if (input.consume(Action.Jump)) {
      if (this.grounded || this.coyote > 0) {
        this.jump();
      } else if (this.sliding) {
        // Cancelling a slide into a jump is a deliberate affordance:
        // it rescues a mistimed slide instead of punishing it.
        this.endSlide();
        this.jump();
      }
    }

    if (input.consume(Action.Slide)) {
      if (this.grounded) this.startSlide();
      else this.queuedSlide = true; // fast-fall, then slide on landing
    }
  }

  private moveLane(direction: number): void {
    const next = clamp(this.lane + direction, 0, LANE_COUNT - 1);
    if (next === this.lane) return;
    this.lane = next;
    this.laneStartX = this.x;
    this.laneElapsed = 0;
    // Longer hops (a chained double-switch) take proportionally longer,
    // so lateral speed stays constant and predictable.
    const distance = Math.abs(LANE_X[this.lane] - this.laneStartX);
    this.laneDuration = clamp((distance / LANE_WIDTH) * LANE_CHANGE_TIME, 0.085, 0.26);
    this.events.onLaneChange?.(direction);
  }

  private jump(): void {
    this.verticalVelocity = JUMP_VELOCITY;
    this.grounded = false;
    this.coyote = 0;
    this.sliding = false;
    this.slideTimer = 0;
    this.events.onJump?.();
  }

  private startSlide(): void {
    this.sliding = true;
    this.slideTimer = SLIDE_TIME;
    this.queuedSlide = false;
    this.events.onSlide?.();
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideTimer = 0;
  }

  // ── Integration ───────────────────────────────────────────────────
  private integrateVertical(dt: number): void {
    if (!this.grounded) {
      // Fast-fall makes the jump arc feel controllable rather than
      // committed, which is what keeps late reactions viable.
      const g = this.queuedSlide && this.verticalVelocity < 2 ? FAST_FALL_GRAVITY : GRAVITY;
      this.verticalVelocity -= g * dt;
      this.y += this.verticalVelocity * dt;

      if (this.y <= 0) {
        const impact = clamp(-this.verticalVelocity / JUMP_VELOCITY, 0, 1.4);
        this.y = 0;
        this.verticalVelocity = 0;
        this.grounded = true;
        this.events.onLand?.(impact);
        if (this.queuedSlide) this.startSlide();
      }
    } else {
      this.coyote = COYOTE_TIME;
    }
    if (this.grounded && this.coyote > 0) this.coyote -= dt;

    const airTarget = this.grounded ? 0 : 1;
    this.airBlend += (airTarget - this.airBlend) * Math.min(1, dt * 18);
  }

  private integrateLateral(dt: number): void {
    const previousX = this.x;
    if (this.laneElapsed < this.laneDuration) {
      this.laneElapsed = Math.min(this.laneDuration, this.laneElapsed + dt);
      const t = easeOutCubic(this.laneElapsed / this.laneDuration);
      this.x = this.laneStartX + (LANE_X[this.lane] - this.laneStartX) * t;
    } else {
      this.x = LANE_X[this.lane];
    }
    this.lateralVelocity = dt > 0 ? (this.x - previousX) / dt : 0;
  }

  private integrateSlide(dt: number): void {
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.endSlide();
    }
    const target = this.sliding ? 1 : 0;
    this.slideBlend += (target - this.slideBlend) * Math.min(1, dt * 20);
  }

  /** True while the player is in the air high enough to clear low hazards. */
  get isAirborne(): boolean {
    return !this.grounded;
  }

  /** Seconds of slide left; 0 when upright. */
  get slideRemaining(): number {
    return this.sliding ? this.slideTimer : 0;
  }

  /** True while the body still straddles two lanes. */
  get isSwitching(): boolean {
    return this.laneElapsed < this.laneDuration;
  }
}
