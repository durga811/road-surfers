import {
  GRAVITY,
  JUMP_VELOCITY,
  LANE_COUNT,
  PLAYER_HALF_DEPTH,
  SLIDE_TIME,
} from '../core/Config';
import { CollisionTarget } from '../systems/CollisionSystem';
import { Block, ObstacleDef } from '../world/ObstacleTypes';
import {
  createGrid, isTraversable, markGrid, SolverState, SOLVER_STEP,
} from '../world/PathSolver';

export const enum BotAction {
  None = 0,
  Jump = 1,
  Slide = 2,
  Left = 3,
  Right = 4,
}

export interface BotObstacle extends CollisionTarget {
  def: ObstacleDef;
  lane: number;
  baseX: number;
  phase: number;
}

export interface BotState {
  lane: number;
  y: number;
  verticalVelocity: number;
  grounded: boolean;
  sliding: boolean;
  slideRemaining: number;
  switching: boolean;
}

/** How far ahead the bot plans. Longer is safer but slower. */
const HORIZON = 70;
/**
 * Steps the bot commits to coasting before it is allowed to act.
 *
 * Without this the "can I still survive?" test always answers yes —
 * surviving includes acting later — so the planner defers every
 * decision until the frame after the last viable one. The horizon must
 * exceed the longest manoeuvre the bot might need (two lane changes,
 * 300 ms) plus its own decision granularity, or it commits to a plan it
 * no longer has time to execute.
 */
const COMMIT_LEVELS = [24, 16, 10, 5, 0]; // 480 ms … 0 ms

/**
 * A reference player driven by the same reachability solver that
 * validates patterns.
 *
 * Its purpose is falsification: if the bot cannot find a surviving path
 * through a stretch of generated track, then no player could either,
 * and the generator produced something unfair. It is a test harness,
 * never shipped in the game build.
 */
export class Autopilot {
  private readonly grid = createGrid(HORIZON);

  decide(state: BotState, obstacles: readonly BotObstacle[], speed: number): BotAction {
    this.buildGrid(obstacles);
    const start = this.encode(state);

    const candidates: BotAction[] = [BotAction.None];
    if (state.grounded && !state.sliding) candidates.push(BotAction.Jump, BotAction.Slide);
    if (!state.switching) {
      if (state.lane > 0) candidates.push(BotAction.Left);
      if (state.lane < LANE_COUNT - 1) candidates.push(BotAction.Right);
    }

    // Pick the move that survives with the most slack, not merely the
    // one that survives. "Robust for the next 480 ms" beats "survives
    // if every subsequent input is frame-perfect", and doing nothing
    // only wins when it is robust at the longest horizon — otherwise
    // the planner would defer every decision until it was too late.
    let best = BotAction.None;
    let bestSlack = -1;

    for (const action of candidates) {
      const next = this.apply(start, state, action);
      if (!this.laneChangeSafe(state, next, action, speed)) continue;

      // Longest commitment horizon this action still survives at.
      let slack = -1;
      for (let level = 0; level < COMMIT_LEVELS.length; level++) {
        if (isTraversable(this.grid, speed, next.lane, next, COMMIT_LEVELS[level])) {
          slack = COMMIT_LEVELS.length - level;
          break;
        }
      }
      if (slack > bestSlack) { bestSlack = slack; best = action; }
      // Coasting at the longest horizon is unimprovable — take it.
      if (action === BotAction.None && slack === COMMIT_LEVELS.length) return BotAction.None;
    }

    return best;
  }

  /** Maps the live player state onto the solver's frame counters. */
  private encode(state: BotState): SolverState {
    return {
      lane: state.lane,
      airFrames: state.grounded ? 0 : Math.ceil(this.timeToLand(state) / SOLVER_STEP),
      slideFrames: state.sliding ? Math.ceil(state.slideRemaining / SOLVER_STEP) : 0,
    };
  }

  private apply(start: SolverState, state: BotState, action: BotAction): SolverState {
    const next = { ...start };
    switch (action) {
      case BotAction.Jump:
        next.airFrames = Math.ceil(((2 * JUMP_VELOCITY) / GRAVITY) / SOLVER_STEP);
        next.slideFrames = 0;
        break;
      case BotAction.Slide:
        next.slideFrames = Math.ceil(SLIDE_TIME / SOLVER_STEP);
        next.airFrames = 0;
        break;
      case BotAction.Left: next.lane = state.lane - 1; break;
      case BotAction.Right: next.lane = state.lane + 1; break;
      default: break;
    }
    return next;
  }

  /** A lane change straddles both lanes, so the origin must stay clear. */
  private laneChangeSafe(
    state: BotState, next: SolverState, action: BotAction, speed: number,
  ): boolean {
    if (action !== BotAction.Left && action !== BotAction.Right) return true;
    return isTraversable(this.grid, speed, state.lane, { ...next, lane: state.lane });
  }

  /**
   * Compiles the live obstacle list into the solver's occupancy grid.
   * Moving hazards are entered at their full reserved lane span rather
   * than their instantaneous position — the same conservative model the
   * generator validated against.
   */
  buildGrid(obstacles: readonly BotObstacle[]): void {
    this.grid.cells.fill(0);
    for (const o of obstacles) {
      // Grid z runs forward from the player; world z is negative ahead.
      const centre = -o.z;
      if (centre > HORIZON || centre < -8) continue;
      const half = o.halfDepth + PLAYER_HALF_DEPTH;
      for (const offset of o.def.lanes) {
        const lane = o.lane + offset;
        if (lane < 0 || lane >= LANE_COUNT) continue;
        markGrid(this.grid, lane, centre - half, centre + half, o.def.block as Block);
      }
    }
  }

  /** Is a surviving route available at all from this state? Used by the
   *  soak test to tell a bot mistake apart from an unfair track. */
  hasAnyRoute(state: BotState, obstacles: readonly BotObstacle[], speed: number): boolean {
    this.buildGrid(obstacles);
    return isTraversable(this.grid, speed, state.lane, this.encode(state), 0);
  }

  private timeToLand(state: BotState): number {
    const v = state.verticalVelocity;
    const y = Math.max(0, state.y);
    return (v + Math.sqrt(v * v + 2 * GRAVITY * y)) / GRAVITY;
  }
}
