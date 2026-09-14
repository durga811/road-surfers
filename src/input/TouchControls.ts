import { Action, InputManager } from './InputManager';

const ACTIONS: Record<string, Action> = {
  left: Action.Left,
  right: Action.Right,
  jump: Action.Jump,
  slide: Action.Slide,
};

/**
 * The on-screen button pad, for players who prefer discrete controls to
 * swipes.
 *
 * Buttons fire on `pointerdown`, not on `click`: a click waits for the
 * release, which on a touchscreen means the action lands after the
 * finger lifts. Pointer capture keeps the press tracked even if the
 * thumb slides off the button.
 */
export class TouchControls {
  private readonly buttons: HTMLElement[];

  constructor(root: HTMLElement, private readonly input: InputManager) {
    this.buttons = Array.from(root.querySelectorAll<HTMLElement>('.tbtn'));
    for (const button of this.buttons) {
      button.addEventListener('pointerdown', this.onDown);
      button.addEventListener('pointerup', this.onUp);
      button.addEventListener('pointercancel', this.onUp);
      button.addEventListener('contextmenu', preventDefault);
    }
  }

  private readonly onDown = (event: PointerEvent): void => {
    const button = event.currentTarget as HTMLElement;
    const action = ACTIONS[button.dataset.action ?? ''];
    if (action === undefined) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    button.classList.add('is-down');
    this.input.press(action);
  };

  private readonly onUp = (event: PointerEvent): void => {
    (event.currentTarget as HTMLElement).classList.remove('is-down');
  };

  dispose(): void {
    for (const button of this.buttons) {
      button.removeEventListener('pointerdown', this.onDown);
      button.removeEventListener('pointerup', this.onUp);
      button.removeEventListener('pointercancel', this.onUp);
      button.removeEventListener('contextmenu', preventDefault);
    }
  }
}

const preventDefault = (event: Event): void => event.preventDefault();
