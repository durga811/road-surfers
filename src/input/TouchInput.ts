import { Action, InputManager } from './InputManager';

/** Distance (CSS px) a finger must travel before it counts as a swipe. */
const SWIPE_THRESHOLD = 26;
/** A touch shorter and stiller than this is a tap, not a swipe. */
const TAP_MAX_MS = 260;
const TAP_SLOP = 16;

/**
 * Swipe and tap recognition for touch devices.
 *
 * Two decisions matter for feel:
 *
 * 1. Swipes fire on `touchmove`, the instant the threshold is crossed —
 *    not on `touchend`. Waiting for the finger to lift adds the entire
 *    duration of the swipe as input latency, which at 29 m/s is several
 *    metres of track and reads as the game ignoring you.
 *
 * 2. After a swipe fires, the origin resets to the current point, so a
 *    single continuous drag can chain lane changes the way holding and
 *    re-swiping would.
 */
export class TouchInput {
  private active: number | null = null;
  private originX = 0;
  private originY = 0;
  private startedAt = 0;
  private moved = false;
  private enabled = true;

  constructor(
    private readonly target: HTMLElement,
    private readonly input: InputManager,
  ) {
    target.addEventListener('touchstart', this.onStart, { passive: false });
    target.addEventListener('touchmove', this.onMove, { passive: false });
    target.addEventListener('touchend', this.onEnd, { passive: false });
    target.addEventListener('touchcancel', this.onCancel, { passive: true });
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.active = null;
  }

  /** Called on the first touch so the UI can switch to touch hints. */
  onFirstTouch?: () => void;

  private readonly onStart = (event: TouchEvent): void => {
    this.onFirstTouch?.();
    if (!this.enabled || this.active !== null) return;
    const touch = event.changedTouches[0];
    this.active = touch.identifier;
    this.originX = touch.clientX;
    this.originY = touch.clientY;
    this.startedAt = performance.now();
    this.moved = false;
    event.preventDefault();
  };

  private readonly onMove = (event: TouchEvent): void => {
    if (!this.enabled || this.active === null) return;
    const touch = this.find(event);
    if (!touch) return;
    event.preventDefault();

    const dx = touch.clientX - this.originX;
    const dy = touch.clientY - this.originY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    // The dominant axis wins, so a slightly diagonal swipe still does
    // exactly one thing rather than two.
    if (Math.abs(dx) > Math.abs(dy)) {
      this.input.press(dx > 0 ? Action.Right : Action.Left);
    } else {
      this.input.press(dy > 0 ? Action.Slide : Action.Jump);
    }

    this.moved = true;
    this.originX = touch.clientX;
    this.originY = touch.clientY;
  };

  private readonly onEnd = (event: TouchEvent): void => {
    if (this.active === null) return;
    const touch = this.find(event);
    if (!touch) return;
    event.preventDefault();

    const quick = performance.now() - this.startedAt < TAP_MAX_MS;
    const still = Math.abs(touch.clientX - this.originX) < TAP_SLOP
      && Math.abs(touch.clientY - this.originY) < TAP_SLOP;
    if (this.enabled && !this.moved && quick && still) this.input.press(Action.Jump);

    this.active = null;
  };

  private readonly onCancel = (): void => {
    this.active = null;
  };

  private find(event: TouchEvent): Touch | null {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.active) return touch;
    }
    return null;
  }

  dispose(): void {
    this.target.removeEventListener('touchstart', this.onStart);
    this.target.removeEventListener('touchmove', this.onMove);
    this.target.removeEventListener('touchend', this.onEnd);
    this.target.removeEventListener('touchcancel', this.onCancel);
  }
}

/**
 * Whether a touchscreen exists at all. Capability, not preference — a
 * laptop with a touchscreen reports true, and its owner will still use
 * the keyboard, so this only decides whether to *listen*, never what UI
 * to show.
 */
export function hasTouchScreen(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * The best initial guess at which UI to show, before the player has
 * actually touched anything. Refined the moment they do: see
 * `Game.setInputMethod`.
 */
export function prefersTouchUI(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
