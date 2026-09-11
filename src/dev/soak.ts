import {
  DESPAWN_BEHIND,
  PLAYER_HALF_WIDTH,
  PLAYER_SLIDE_HEIGHT,
  PLAYER_STAND_HEIGHT,
  SPEED_MAX,
  SPEED_START,
  SPEED_RAMP_TIME,
  TIER_DISTANCE,
  VIEW_DISTANCE,
} from '../core/Config';
import { Random } from '../core/Random';
import { clamp } from '../core/MathUtils';
import { PlayerMovement } from '../player/PlayerMovement';
import { Action, ActionSource } from '../input/InputManager';
import { CollisionSystem } from '../systems/CollisionSystem';
import { ProceduralGenerator } from '../world/ProceduralGenerator';
import { obstacleCentreX, OBSTACLES } from '../world/ObstacleTypes';
import { Autopilot, BotAction, BotObstacle, BotState } from './Autopilot';

export interface SoakResult {
  seed: number;
  survivedMetres: number;
  survivedSeconds: number;
  deaths: {
    distance: number;
    speed: number;
    tier: number;
    obstacle: string;
    lane: number;
    /** Diagnostics: was this a margin failure or a genuine dead end? */
    playerLane: number;
    playerX: number;
    switching: boolean;
    airborne: boolean;
    sliding: boolean;
    obstacleZ: number;
    /** Seconds of warning the bot had before contact. */
    /**
     * True when no surviving route existed a second before impact —
     * i.e. the generator, not the bot, is at fault. This is the only
     * condition the soak actually fails on.
     */
    genuineDeadEnd: boolean;
    /** Everything within the bot's planning window when it died. */
    scene: string[];
  }[];
  botMistakes: number;
  deadEnds: number;
  obstaclesPassed: number;
  coinsPassed: number;
  maxActiveObstacles: number;
}

/**
 * Headless end-to-end simulation.
 *
 * Runs the real generator, the real player movement code and the real
 * collision system against a solver-driven bot, with no renderer in the
 * loop. If the bot dies, the generator emitted a stretch of track with
 * no surviving path — which is the exact failure mode the fairness
 * guarantee is supposed to make impossible.
 */
export function soak(seed: number, targetMetres: number): SoakResult {
  const rng = new Random(seed);
  const generator = new ProceduralGenerator(rng);
  const movement = new PlayerMovement();
  const collisions = new CollisionSystem<BotObstacle>();
  const bot = new Autopilot();

  const obstacles: BotObstacle[] = [];
  let cursorZ = -58;
  let distance = 0;
  let elapsed = 0;
  let coinsPassed = 0;
  let obstaclesPassed = 0;
  let maxActive = 0;

  const result: SoakResult = {
    seed, survivedMetres: 0, survivedSeconds: 0, deaths: [],
    obstaclesPassed: 0, coinsPassed: 0, maxActiveObstacles: 0,
    botMistakes: 0, deadEnds: 0,
  };

  // Rolling history so a death can be re-examined from a second earlier,
  // when the player still had room to choose.
  interface Snapshot { state: BotState; obstacles: BotObstacle[] }
  const history: Snapshot[] = [];
  const HISTORY_STRIDE = 10;      // frames between snapshots
  const HISTORY_DEPTH = 12;       // ≈ 2 s of history
  let frame = 0;

  const dt = 1 / 60;
  // Bot decisions run at 30 Hz; a human cannot re-plan every frame and
  // the test should not depend on superhuman input rates.
  let decideCounter = 0;
  let pendingAction = BotAction.None;

  while (distance < targetMetres) {
    elapsed += dt;
    const t = clamp(elapsed / SPEED_RAMP_TIME, 0, 1);
    const speed = SPEED_START + (SPEED_MAX - SPEED_START) * (1 - Math.pow(1 - t, 2.1));
    const deltaZ = speed * dt;
    distance += deltaZ;

    let tier = 0;
    for (let i = TIER_DISTANCE.length - 1; i >= 0; i--) {
      if (distance >= TIER_DISTANCE[i]) { tier = i; break; }
    }

    // ── World ──────────────────────────────────────────────────────
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.prevZ = o.z;
      o.z += deltaZ;
      if (o.def.motion === 'patrol') {
        o.x = o.baseX + Math.sin(elapsed * 1.15 + o.phase) * 1.125;
      } else if (o.def.motion === 'sweep') {
        o.x = Math.sin(elapsed * 1.5 + o.phase) * 2.25;
      }
      if (o.z > DESPAWN_BEHIND) {
        obstaclesPassed++;
        obstacles.splice(i, 1);
      }
    }

    cursorZ += deltaZ;
    let guard = 0;
    while (cursorZ > -VIEW_DISTANCE && guard++ < 6) {
      const chunk = generator.next(tier, speed);
      for (const spec of chunk.obstacles) {
        const def = OBSTACLES[spec.type];
        obstacles.push({
          def,
          lane: spec.lane,
          x: obstacleCentreX(def, spec.lane),
          baseX: obstacleCentreX(def, spec.lane),
          phase: rng.range(0, Math.PI * 2),
          z: cursorZ - spec.z,
          prevZ: cursorZ - spec.z,
          halfWidth: def.width / 2,
          halfDepth: def.depth / 2,
          minY: def.minY,
          maxY: def.maxY,
          resolved: false,
        });
      }
      coinsPassed += chunk.coins.length;
      cursorZ -= chunk.length;
    }
    if (obstacles.length > maxActive) maxActive = obstacles.length;

    if (frame++ % HISTORY_STRIDE === 0) {
      history.push({
        state: {
          lane: movement.lane, y: movement.y, verticalVelocity: movement.verticalVelocity,
          grounded: movement.grounded, sliding: movement.sliding,
          slideRemaining: movement.slideRemaining, switching: movement.isSwitching,
        },
        obstacles: obstacles.map((o) => ({ ...o })),
      });
      if (history.length > HISTORY_DEPTH) history.shift();
    }

    // ── Bot ────────────────────────────────────────────────────────
    if (decideCounter-- <= 0) {
      decideCounter = 1;
      pendingAction = bot.decide(
        {
          lane: movement.lane,
          y: movement.y,
          verticalVelocity: movement.verticalVelocity,
          grounded: movement.grounded,
          sliding: movement.sliding,
          slideRemaining: movement.slideRemaining,
          switching: movement.isSwitching,
        },
        obstacles,
        speed,
      );
    }

    movement.update(dt, makeInput(pendingAction), true);
    pendingAction = BotAction.None;

    // ── Collision ──────────────────────────────────────────────────
    const height = PLAYER_STAND_HEIGHT
      + (PLAYER_SLIDE_HEIGHT - PLAYER_STAND_HEIGHT) * movement.slideBlend;
    const hit = collisions.check(
      {
        minX: movement.x - PLAYER_HALF_WIDTH,
        maxX: movement.x + PLAYER_HALF_WIDTH,
        minY: movement.y + 0.05,
        maxY: movement.y + height,
      },
      obstacles,
    ).obstacle;

    if (hit) {
      // Was the track already unwinnable a second ago, or did the bot
      // simply play it badly?
      const past = history[Math.max(0, history.length - 7)];
      const genuineDeadEnd = past ? !bot.hasAnyRoute(past.state, past.obstacles, speed) : false;
      if (genuineDeadEnd) result.deadEnds++; else result.botMistakes++;

      result.deaths.push({
        genuineDeadEnd,
        distance: Math.round(distance),
        speed: Number(speed.toFixed(1)),
        tier,
        obstacle: hit.def.type,
        lane: hit.lane,
        playerLane: movement.lane,
        playerX: Number(movement.x.toFixed(2)),
        switching: movement.isSwitching,
        airborne: !movement.grounded,
        sliding: movement.sliding,
        obstacleZ: Number(hit.z.toFixed(2)),
        scene: obstacles
          .filter((o) => o.z > -90 && o.z < 12)
          .sort((a, b) => b.z - a.z)
          .map((o) => `${o.def.type}@z${o.z.toFixed(1)} lanes[${o.def.lanes.map((l) => l + o.lane).join(',')}] blk${o.def.block}`),
      });
      // Keep running so one bad spot doesn't hide the rest of the run.
      if (result.deaths.length > 24) break;
    }
  }

  result.survivedMetres = Math.round(distance);
  result.survivedSeconds = Number(elapsed.toFixed(1));
  result.obstaclesPassed = obstaclesPassed;
  result.coinsPassed = coinsPassed;
  result.maxActiveObstacles = maxActive;
  return result;
}

/**
 * Minimal InputManager stand-in. PlayerMovement only ever calls
 * `consume`, so the bot can drive the real movement code unmodified.
 */
function makeInput(action: BotAction): ActionSource {
  const map: Record<number, number> = {
    [BotAction.Left]: 0,
    [BotAction.Right]: 1,
    [BotAction.Jump]: 2,
    [BotAction.Slide]: 3,
  };
  const wanted = map[action];
  let used = false;
  return {
    consume(a: Action): boolean {
      if (used || wanted === undefined || (a as number) !== wanted) return false;
      used = true;
      return true;
    },
  };
}
