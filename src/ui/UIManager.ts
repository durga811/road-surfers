import { PowerUpKind } from '../world/ProceduralGenerator';
import { ActivePowerUp, POWER_CSS, POWER_LABEL } from '../systems/PowerUpSystem';

interface Screens {
  start: HTMLElement;
  pause: HTMLElement;
  over: HTMLElement;
}

export interface UICallbacks {
  onPlay: () => void;
  onResume: () => void;
  onQuit: () => void;
  onRetry: () => void;
  onMenu: () => void;
  onToggleSound: (muted: boolean) => void;
  onPause: () => void;
  onScheme: (scheme: ControlScheme) => void;
}

export type ControlScheme = 'swipe' | 'buttons';

/**
 * Thin DOM layer. The HUD is deliberately written to only when a value
 * actually changes — string formatting every frame is a real cost at
 * 144 Hz, and layout thrash shows up as jank long before the renderer
 * does.
 */
export class UIManager {
  private readonly screens: Screens;
  private readonly hud: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly loading: HTMLElement;

  private readonly scoreEl: HTMLElement;
  private readonly coinsEl: HTMLElement;
  private readonly coinChip: HTMLElement;
  private readonly distanceEl: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly powerupsEl: HTMLElement;
  private readonly popupsEl: HTMLElement;
  private readonly soundBtn: HTMLElement;
  private readonly topbar: HTMLElement;

  private lastScore = -1;
  private lastCoins = -1;
  private lastDistance = -1;
  private lastSpeed = -1;
  private bumpTimer = 0;
  private flashTimer = 0;

  private readonly powerNodes = new Map<PowerUpKind, { root: HTMLElement; bar: HTMLElement }>();

  constructor(callbacks: UICallbacks) {
    const $ = (id: string): HTMLElement => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`UI element #${id} is missing`);
      return el;
    };

    this.screens = { start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over') };
    this.hud = $('hud');
    this.flash = $('flash');
    this.loading = $('loading');
    this.scoreEl = $('hud-score');
    this.coinsEl = $('hud-coins');
    this.coinChip = this.coinsEl.parentElement as HTMLElement;
    this.distanceEl = $('hud-distance');
    this.speedEl = $('hud-speed');
    this.powerupsEl = $('hud-powerups');
    this.popupsEl = $('hud-popups');
    this.soundBtn = $('btn-sound');
    this.topbar = this.soundBtn.parentElement as HTMLElement;

    $('btn-play').addEventListener('click', callbacks.onPlay);
    $('btn-resume').addEventListener('click', callbacks.onResume);
    $('btn-quit').addEventListener('click', callbacks.onQuit);
    $('btn-retry').addEventListener('click', callbacks.onRetry);
    $('btn-menu').addEventListener('click', callbacks.onMenu);
    $('btn-pause').addEventListener('click', callbacks.onPause);

    for (const option of Array.from(document.querySelectorAll<HTMLElement>('.scheme__opt'))) {
      option.addEventListener('click', () => {
        const scheme = option.dataset.scheme as ControlScheme;
        this.setScheme(scheme);
        callbacks.onScheme(scheme);
      });
    }
    this.soundBtn.addEventListener('click', () => {
      const muted = !this.soundBtn.classList.contains('is-muted');
      this.setMuted(muted);
      callbacks.onToggleSound(muted);
    });
  }

  bootComplete(): void {
    this.loading.classList.add('is-done');
  }

  setMuted(muted: boolean): void {
    this.soundBtn.classList.toggle('is-muted', muted);
  }

  showScreen(name: keyof Screens | null): void {
    for (const key of Object.keys(this.screens) as (keyof Screens)[]) {
      this.screens[key].classList.toggle('is-visible', key === name);
    }
  }

  setHudVisible(visible: boolean): void {
    this.hud.classList.toggle('is-visible', visible);
  }

  /** Shows the on-screen pause control only while a run is live. */
  setRunning(running: boolean): void {
    this.topbar.classList.toggle('is-running', running);
    // The thumb pad appears with the run and leaves with it, so menus
    // are never cluttered by controls that do nothing.
    document.body.classList.toggle('is-playing', running);
  }

  /** Swaps control hints and the on-screen pad for touch devices. */
  setTouchMode(enabled: boolean): void {
    document.body.classList.toggle('is-touch', enabled);
  }

  setScheme(scheme: ControlScheme): void {
    document.body.classList.toggle('scheme-buttons', scheme === 'buttons');
    for (const option of Array.from(document.querySelectorAll<HTMLElement>('.scheme__opt'))) {
      option.classList.toggle('is-active', option.dataset.scheme === scheme);
    }
  }

  setPortrait(portrait: boolean): void {
    document.body.classList.toggle('is-portrait', portrait);
  }

  // ── HUD ────────────────────────────────────────────────────────────
  updateHud(score: number, coins: number, distance: number, intensity: number, dt: number): void {
    const s = Math.floor(score);
    if (s !== this.lastScore) {
      this.scoreEl.textContent = s.toLocaleString('en-US');
      this.lastScore = s;
    }
    if (coins !== this.lastCoins) {
      this.coinsEl.textContent = String(coins);
      this.lastCoins = coins;
      this.coinChip.classList.remove('is-bump');
      void this.coinChip.offsetWidth; // restart the CSS animation
      this.coinChip.classList.add('is-bump');
    }
    const d = Math.floor(distance);
    if (d !== this.lastDistance) {
      this.distanceEl.textContent = String(d);
      this.lastDistance = d;
    }
    const pct = Math.round(intensity * 100);
    if (pct !== this.lastSpeed) {
      this.speedEl.style.width = `${pct}%`;
      this.lastSpeed = pct;
    }

    if (this.bumpTimer > 0) {
      this.bumpTimer -= dt;
      if (this.bumpTimer <= 0) this.scoreEl.classList.remove('is-bump');
    }
  }

  bumpScore(): void {
    this.scoreEl.classList.add('is-bump');
    this.bumpTimer = 0.18;
  }

  updatePowerUps(active: readonly ActivePowerUp[]): void {
    // Remove nodes whose effect has expired.
    for (const [kind, node] of this.powerNodes) {
      if (!active.some((p) => p.kind === kind)) {
        node.root.remove();
        this.powerNodes.delete(kind);
      }
    }
    for (const power of active) {
      let node = this.powerNodes.get(power.kind);
      if (!node) {
        const root = document.createElement('div');
        root.className = 'pu';
        root.style.color = POWER_CSS[power.kind];
        root.innerHTML =
          `<span class="pu__dot"></span><span>${POWER_LABEL[power.kind]}</span>` +
          `<span class="pu__bar"><i></i></span>`;
        this.powerupsEl.appendChild(root);
        node = { root, bar: root.querySelector('i') as HTMLElement };
        this.powerNodes.set(power.kind, node);
      }
      const t = Math.max(0, power.remaining / power.duration);
      node.bar.style.transform = `scaleX(${t.toFixed(3)})`;
      node.root.classList.toggle('is-ending', power.remaining < 2);
    }
  }

  popup(text: string, color: string): void {
    const el = document.createElement('div');
    el.className = 'popup';
    el.style.color = color;
    el.textContent = text;
    this.popupsEl.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  flashHit(kind: 'hit' | 'shield'): void {
    const active = kind === 'hit' ? 'is-hit' : 'is-shield';
    this.flash.classList.add(active);
    // A wall-clock timeout rather than a double rAF: if the tab is being
    // throttled, a frame-counted release can leave the screen tinted for
    // seconds.
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flash.classList.remove('is-hit', 'is-shield');
    }, 70);
  }

  // ── Screens ────────────────────────────────────────────────────────
  showStart(best: number): void {
    const el = document.getElementById('start-best')!;
    if (best > 0) {
      el.hidden = false;
      (el.querySelector('b') as HTMLElement).textContent = best.toLocaleString('en-US');
    } else {
      el.hidden = true;
    }
    this.showScreen('start');
  }

  showPause(score: number, distance: number): void {
    document.getElementById('pause-score')!.textContent = Math.floor(score).toLocaleString('en-US');
    document.getElementById('pause-distance')!.textContent = `${Math.floor(distance)}m`;
    this.showScreen('pause');
  }

  showGameOver(score: number, distance: number, coins: number, best: number, isRecord: boolean): void {
    document.getElementById('over-title')!.textContent = isRecord ? 'New Record' : 'Run Ended';
    document.getElementById('over-distance')!.textContent = `${Math.floor(distance)}m`;
    document.getElementById('over-coins')!.textContent = String(coins);
    document.getElementById('over-best')!.textContent = best.toLocaleString('en-US');
    this.showScreen('over');
    this.countUp(document.getElementById('over-score')!, Math.floor(score));
  }

  /** Score tally on the game-over card — the one place a flourish earns
   *  its keep, because it gives the run a beat of resolution. */
  private countUp(el: HTMLElement, target: number): void {
    const duration = Math.min(900, 260 + target * 0.35);
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.floor(target * eased).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resetHud(): void {
    this.lastScore = -1;
    this.lastCoins = -1;
    this.lastDistance = -1;
    this.lastSpeed = -1;
    for (const node of this.powerNodes.values()) node.root.remove();
    this.powerNodes.clear();
  }
}
