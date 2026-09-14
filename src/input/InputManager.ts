import { INPUT_BUFFER } from '../core/Config';

export const enum Action {
  Left,
  Right,
  Jump,
  Slide,
}

/**
 * The only surface PlayerMovement needs. Depending on this instead of
 * the whole InputManager lets the headless test drive the real movement
 * code with a scripted bot.
 */
export interface ActionSource {
  consume(action: Action): boolean;
}

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: Action.Left,
  KeyA: Action.Left,
  ArrowRight: Action.Right,
  KeyD: Action.Right,
  ArrowUp: Action.Jump,
  KeyW: Action.Jump,
  Space: Action.Jump,
  ArrowDown: Action.Slide,
  KeyS: Action.Slide,
};

/**
 * Translates raw key events into buffered game actions.
 *
 * Buffering matters: a jump pressed a few frames before landing should
 * still fire on landing. Without it the game feels like it's ignoring
 * you, which reads as "unresponsive" far more than input latency does.
 */
export class InputManager implements ActionSource {
  private readonly buffer = new Float32Array(4);   // seconds of life left
  private readonly held = new Set<Action>();
  private readonly commands = new Map<string, () => void>();
  private enabled = true;

  /** Called when a real key is pressed, so the UI can show key hints. */
  onKeyboardUse?: () => void;

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.onKeyDown as EventListener);
    this.target.addEventListener('keyup', this.onKeyUp as EventListener);
    window.addEventListener('blur', this.onBlur);
  }

  /** Bind a one-shot key (pause, restart, mute) by KeyboardEvent.code. */
  bindCommand(code: string, handler: () => void): void {
    this.commands.set(code, handler);
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.clear();
  }

  /**
   * Queues an action from a non-keyboard source (touch swipe, on-screen
   * button). Routed through the same buffer so every input path gets
   * identical timing and forgiveness.
   */
  press(action: Action): void {
    if (!this.enabled) return;
    this.buffer[action] = INPUT_BUFFER;
  }

  /** Consumes the action if it was pressed within the buffer window. */
  consume(action: Action): boolean {
    if (this.buffer[action] > 0) {
      this.buffer[action] = 0;
      return true;
    }
    return false;
  }

  peek(action: Action): boolean {
    return this.buffer[action] > 0;
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  update(dt: number): void {
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] > 0) this.buffer[i] = Math.max(0, this.buffer[i] - dt);
    }
  }

  clear(): void {
    this.buffer.fill(0);
    this.held.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (KEY_MAP[event.code] !== undefined || this.commands.has(event.code)) {
      this.onKeyboardUse?.();
    }
    const command = this.commands.get(event.code);
    if (command) {
      event.preventDefault();
      command();
      return;
    }

    const action = KEY_MAP[event.code];
    if (action === undefined) return;
    event.preventDefault(); // stop Space/arrows from scrolling the page
    if (!this.enabled) return;

    // Ignore auto-repeat: holding left must not machine-gun lane changes.
    if (event.repeat) {
      this.held.add(action);
      return;
    }
    this.buffer[action] = INPUT_BUFFER;
    this.held.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_MAP[event.code];
    if (action !== undefined) this.held.delete(action);
  };

  private readonly onBlur = (): void => this.clear();

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
  }
}
