export const enum Phase {
  Menu = 'menu',
  Running = 'running',
  Paused = 'paused',
  Dying = 'dying',
  GameOver = 'over',
}

/** Single source of truth for what the game is currently doing. */
export class GameState {
  private phase: Phase = Phase.Menu;

  get current(): Phase {
    return this.phase;
  }

  set(next: Phase): void {
    this.phase = next;
  }
}
