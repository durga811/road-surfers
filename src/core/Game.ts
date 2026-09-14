import { Stage } from '../render/SceneSetup';
import { CameraController } from '../render/CameraController';
import { Player } from '../player/Player';
import { SkinnedRunner } from '../player/SkinnedRunner';
import { InputManager } from '../input/InputManager';
import { TrackManager } from '../world/TrackManager';
import { CollisionSystem } from '../systems/CollisionSystem';
import { ActiveObstacle } from '../world/ObstacleManager';
import { DifficultyManager } from '../systems/DifficultyManager';
import { ScoreSystem } from '../systems/ScoreSystem';
import { PowerUpSystem } from '../systems/PowerUpSystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import { AudioManager } from '../audio/AudioManager';
import { UIManager } from '../ui/UIManager';
import { GameLoop } from './GameLoop';
import { GameState, Phase } from './GameState';
import { Random } from './Random';
import { Palette } from '../render/Palette';
import { PowerUpKind } from '../world/ProceduralGenerator';
import { POWER_CSS, POWER_LABEL } from '../systems/PowerUpSystem';
import { clamp, damp } from './MathUtils';
import { SPEED_START } from './Config';

const MENU_SPEED = 8.5;
const DEATH_DURATION = 1.35;
const NEAR_MISS_COOLDOWN = 1.1;

/**
 * Wires every subsystem together and owns the phase machine. Systems
 * talk to each other only through this class, so the dependency graph
 * stays a star rather than a web.
 */
export class Game {
  private readonly stage: Stage;
  private readonly camera: CameraController;
  private readonly input: InputManager;
  private readonly player: Player;
  private readonly track: TrackManager;
  private readonly collisions = new CollisionSystem<ActiveObstacle>();
  private readonly difficulty = new DifficultyManager();
  private readonly score = new ScoreSystem();
  private readonly powerUps = new PowerUpSystem();
  private readonly particles = new ParticleSystem();
  private readonly audio = new AudioManager();
  private readonly ui: UIManager;
  private readonly state = new GameState();
  private readonly loop: GameLoop;
  private readonly rng = new Random();

  private enclosure = 0;
  private lastTier = 0;
  private slideSparkTimer = 0;
  private deathTimer = 0;
  private deathSpeed = 0;
  private nearMissCooldown = 0;
  private isRecord = false;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.camera = new CameraController(this.stage.camera);

    this.input = new InputManager();
    this.player = new Player({
      onJump: () => {
        this.audio.jump();
        this.particles.burst(this.player.x, 0.1, 0, 5, Palette.cyan, {
          speed: 2.4, life: 0.32, gravity: 9, scale: 0.55, up: 0.15, spread: 0.7,
        });
      },
      onLand: (impact) => {
        this.audio.land(impact);
        if (impact > 0.25) {
          this.particles.burst(this.player.x, 0.08, 0, 6, Palette.mint, {
            speed: 2.2 + impact * 2, life: 0.3, gravity: 12, scale: 0.5, up: 0.2, spread: 1,
          });
          this.camera.addShake(impact * 0.1);
        }
      },
      onSlide: () => {
        this.audio.slide();
        this.particles.burst(this.player.x, 0.12, 0.3, 8, Palette.cyan, {
          speed: 2.8, life: 0.4, gravity: 8, scale: 0.5, up: 0.25, spread: 1.1,
        });
      },
      onLaneChange: () => this.audio.laneChange(),
    });

    this.track = new TrackManager(this.rng);

    this.stage.scene.add(this.track.group);
    this.stage.scene.add(this.player.object);
    this.stage.scene.add(this.particles.group);

    this.ui = new UIManager({
      onPlay: () => this.startRun(),
      onResume: () => this.resume(),
      onQuit: () => this.toMenu(),
      onRetry: () => this.startRun(),
      onMenu: () => this.toMenu(),
      onPause: () => this.togglePause(),
      onToggleSound: (muted) => {
        this.audio.unlock();
        this.audio.setMuted(muted);
        if (!muted) this.audio.uiClick();
      },
    });
    this.ui.setMuted(this.audio.isMuted);

    this.bindCommands();
    this.loop = new GameLoop(this.update);
  }

  async start(): Promise<void> {
    this.track.reset();
    this.camera.reset(false);

    // The skinned runner is the intended character; the primitive rig is
    // already in place, so a failed fetch degrades to it without a stall.
    try {
      const rig = await SkinnedRunner.load(`${import.meta.env.BASE_URL}models/runner.glb`);
      this.player.setRig(rig);
    } catch (error) {
      console.warn('[road-surfers] runner model unavailable, using fallback rig', error);
    }

    this.ui.showStart(this.score.best);
    this.ui.bootComplete();
    this.loop.start();
  }

  // ── Phase transitions ─────────────────────────────────────────────

  private startRun(): void {
    this.audio.unlock();
    this.audio.uiClick();

    this.score.reset();
    this.difficulty.reset();
    this.powerUps.reset();
    this.particles.clear();
    this.track.reset();
    this.player.reset();
    this.camera.reset(true);
    this.input.clear();
    this.input.setEnabled(true);

    this.deathTimer = 0;
    this.enclosure = 0;
    this.lastTier = 0;
    this.nearMissCooldown = 0;
    this.isRecord = false;

    this.ui.resetHud();
    this.ui.showScreen(null);
    this.ui.setHudVisible(true);
    this.ui.updatePowerUps(this.powerUps.active);

    this.audio.startMusic();
    this.ui.setRunning(true);
    this.state.set(Phase.Running);
  }

  private toMenu(): void {
    this.audio.uiBack();
    this.track.reset();
    this.player.reset();
    this.particles.clear();
    this.powerUps.reset();
    this.camera.reset(false);
    this.input.setEnabled(false);
    this.ui.setHudVisible(false);
    this.ui.setRunning(false);
    this.ui.showStart(this.score.best);
    this.audio.stopMusic();
    this.state.set(Phase.Menu);
  }

  private togglePause(): void {
    if (this.state.current === Phase.Running) {
      this.state.set(Phase.Paused);
      this.input.setEnabled(false);
      this.audio.duckMusic();
      this.audio.uiBack();
      this.ui.setRunning(false);
      this.ui.showPause(this.score.score, this.score.distance);
    } else if (this.state.current === Phase.Paused) {
      this.resume();
    }
  }

  private resume(): void {
    if (this.state.current !== Phase.Paused) return;
    this.audio.uiClick();
    this.audio.startMusic();
    this.input.clear();
    this.input.setEnabled(true);
    this.ui.showScreen(null);
    this.ui.setRunning(true);
    this.state.set(Phase.Running);
  }

  private die(): void {
    this.state.set(Phase.Dying);
    this.input.setEnabled(false);
    this.ui.setRunning(false);
    this.deathTimer = DEATH_DURATION;
    this.deathSpeed = this.difficulty.speed;

    this.player.crash();
    this.camera.addShake(1.2);
    this.audio.crash();
    this.audio.stopMusic();
    this.ui.flashHit('hit');

    this.particles.burst(this.player.x, 0.7, 0, 26, Palette.hazardGlow, {
      speed: 8, life: 0.9, gravity: 20, scale: 1.1, up: 0.6, spread: 1.3, worldLocked: false,
    });
    this.particles.burst(this.player.x, 0.7, 0, 12, Palette.player, {
      speed: 5, life: 0.7, gravity: 18, scale: 0.8, up: 0.8, spread: 1, worldLocked: false,
    });
  }

  private gameOver(): void {
    this.isRecord = this.score.finalise();
    this.ui.setHudVisible(false);
    this.ui.showGameOver(
      this.score.score, this.score.distance, this.score.coins, this.score.best, this.isRecord,
    );
    this.state.set(Phase.GameOver);
  }

  // ── Frame ─────────────────────────────────────────────────────────

  private readonly update = (dt: number, elapsed: number): void => {
    this.input.update(dt);

    switch (this.state.current) {
      case Phase.Menu:
        this.updateMenu(dt, elapsed);
        break;
      case Phase.Running:
        this.updateRunning(dt, elapsed);
        break;
      case Phase.Dying:
        this.updateDying(dt, elapsed);
        break;
      case Phase.Paused:
      case Phase.GameOver:
        break;
    }

    this.stage.update(elapsed);
    // Only judge performance while actually playing and visible: a
    // backgrounded tab throttles rAF to about 1 fps, and letting that
    // count would permanently downgrade the renderer on a machine that
    // was never struggling.
    if (this.state.current === Phase.Running && !document.hidden) {
      this.stage.monitorPerformance(this.loop.fps, dt);
    }
    this.stage.render();
  };

  private updateMenu(dt: number, elapsed: number): void {
    const deltaZ = MENU_SPEED * dt;
    this.track.update(dt, deltaZ, elapsed, 0, SPEED_START, 0, 0, false, false);
    this.player.update(dt, this.input, MENU_SPEED, false);
    this.particles.update(dt, deltaZ);
    this.camera.updateMenu(dt, elapsed);
    this.stage.followShadows(0);
  }

  private updateRunning(dt: number, elapsed: number): void {
    this.powerUps.update(dt);
    this.difficulty.update(dt, this.score.distance, this.powerUps.surge, this.powerUps.surgeSpeed);
    this.score.multiplier = this.powerUps.scoreMultiplier;

    const speed = this.difficulty.speed;
    const deltaZ = speed * dt;
    this.score.addDistance(deltaZ);

    this.player.update(dt, this.input, speed, true);
    this.track.update(
      dt, deltaZ, elapsed, this.difficulty.tier, speed,
      this.player.x, this.player.y, this.powerUps.magnet, true,
    );
    this.particles.update(dt, deltaZ);

    this.emitSlideSparks(dt, speed);
    this.handleCollectibles();
    this.handleCollisions();

    this.camera.update(
      dt, this.player.x, this.player.y, this.difficulty.intensity,
      this.player.movement.lateralVelocity, this.player.movement.isAirborne,
    );
    this.stage.followShadows(this.player.x);
    this.enclosure = damp(this.enclosure, this.track.environment.enclosure, 3, dt);
    this.stage.setEnclosure(this.enclosure);
    this.audio.update(this.difficulty.intensity);

    if (this.nearMissCooldown > 0) this.nearMissCooldown -= dt;

    if (this.difficulty.tier !== this.lastTier) {
      this.lastTier = this.difficulty.tier;
      this.ui.popup(`Zone ${this.lastTier + 1}`, '#4de3ff');
      this.audio.powerUp();
    }

    this.ui.updateHud(
      this.score.score, this.score.coins, this.score.distance, this.difficulty.intensity, dt,
    );
    this.ui.updatePowerUps(this.powerUps.active);
    this.player.setShield(this.powerUps.has('shield'));
  }

  private updateDying(dt: number, elapsed: number): void {
    this.deathTimer -= dt;
    // Ease the world to a stop rather than cutting: the deceleration is
    // what makes the crash land emotionally.
    const t = clamp(this.deathTimer / DEATH_DURATION, 0, 1);
    const speed = this.deathSpeed * t * t;
    const deltaZ = speed * dt;

    this.track.update(dt, deltaZ, elapsed, this.difficulty.tier, speed, this.player.x, 0, false, false);
    this.particles.update(dt, deltaZ);
    this.player.update(dt, this.input, speed, false);
    this.camera.updateCrash(dt, this.player.x);
    this.stage.followShadows(this.player.x);

    if (this.deathTimer <= 0) this.gameOver();
  }

  /** A continuous scrape while sliding — the one effect that runs on a
   *  timer rather than an event, because a slide is a held state. */
  private emitSlideSparks(dt: number, speed: number): void {
    if (!this.player.movement.sliding) {
      this.slideSparkTimer = 0;
      return;
    }
    this.slideSparkTimer -= dt;
    if (this.slideSparkTimer > 0) return;
    this.slideSparkTimer = 0.045;
    this.particles.burst(this.player.x, 0.1, 0.35, 2, Palette.cyan, {
      speed: 1.6 + speed * 0.06, life: 0.26, gravity: 10, scale: 0.34, up: 0.5, spread: 0.8,
    });
  }

  // ── Gameplay reactions ────────────────────────────────────────────

  private handleCollectibles(): void {
    const collected = this.track.collectibles.collect(
      this.player.x, this.player.y,
      (x, y, z) => {
        this.particles.burst(x, y, z, 5, Palette.coin, {
          speed: 3, life: 0.36, gravity: 6, scale: 0.55, up: 0.4, spread: 1,
        });
      },
    );

    if (collected > 0) {
      this.score.addCoins(collected);
      this.audio.coin();
      this.ui.bumpScore();
    }

    this.track.collectibles.collectPowerUps(this.player.x, this.player.y, (kind, x, y) => {
      this.activatePowerUp(kind, x, y);
    });
  }

  private activatePowerUp(kind: PowerUpKind, x: number, y: number): void {
    this.powerUps.activate(kind);
    this.audio.powerUp();
    this.ui.popup(POWER_LABEL[kind], POWER_CSS[kind]);
    this.particles.burst(x, y, 0, 14, powerParticleColor(kind), {
      speed: 5, life: 0.55, gravity: 8, scale: 0.7, up: 0.4, spread: 1.2,
    });
    if (kind === 'surge') this.camera.addShake(0.22);
  }

  private handleCollisions(): void {
    const result = this.collisions.check(this.player.getBounds(), this.track.obstacles.active);

    for (const miss of result.nearMisses) {
      this.score.addNearMiss();
      this.audio.nearMiss();
      if (this.nearMissCooldown <= 0) {
        this.nearMissCooldown = NEAR_MISS_COOLDOWN;
        this.ui.popup('Close', '#8affd6');
      }
      this.particles.burst(miss.x, 1.0, 0.4, 3, Palette.mint, {
        speed: 2.4, life: 0.28, gravity: 4, scale: 0.4, up: 0.2, spread: 1,
      });
    }

    if (!result.obstacle) return;

    if (this.powerUps.consumeShield()) {
      const hit = result.obstacle;
      this.audio.shieldBreak();
      this.ui.flashHit('shield');
      this.ui.popup('Shield Down', POWER_CSS.shield);
      this.camera.addShake(0.55);
      this.player.flinch();
      this.player.setShield(false);
      // The shield shatters the hazard rather than phasing through it:
      // coral shards from the obstacle, cyan from the shield.
      this.particles.burst(hit.x, 1.0, hit.z, 18, Palette.hazardGlow, {
        speed: 7, life: 0.6, gravity: 12, scale: 0.8, up: 0.5, spread: 1.3,
      });
      this.particles.burst(this.player.x, 0.7, 0, 14, Palette.cyan, {
        speed: 6, life: 0.55, gravity: 10, scale: 0.7, up: 0.5, spread: 1.2,
      });
      this.track.obstacles.destroy(hit);
      return;
    }

    this.die();
  }

  // ── Input bindings ────────────────────────────────────────────────

  private bindCommands(): void {
    const pause = (): void => this.togglePause();
    this.input.bindCommand('Escape', pause);
    this.input.bindCommand('KeyP', pause);

    this.input.bindCommand('KeyR', () => {
      if (this.state.current === Phase.GameOver || this.state.current === Phase.Paused) {
        this.startRun();
      }
    });

    this.input.bindCommand('KeyM', () => {
      this.audio.unlock();
      const muted = this.audio.toggleMute();
      this.ui.setMuted(muted);
    });

    this.input.bindCommand('Enter', () => {
      if (this.state.current === Phase.Menu || this.state.current === Phase.GameOver) {
        this.startRun();
      } else if (this.state.current === Phase.Paused) {
        this.resume();
      }
    });

    // Losing focus mid-run would otherwise mean an unfair death.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.current === Phase.Running) this.togglePause();
    });
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.stage.dispose();
  }
}

function powerParticleColor(kind: PowerUpKind): number {
  return kind === 'magnet' ? Palette.magnet : kind === 'shield' ? Palette.shield : Palette.surge;
}
