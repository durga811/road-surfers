import {
  GRAVITY,
  JUMP_VELOCITY,
  LANE_CHANGE_TIME,
  LANE_COUNT,
  SLIDE_TIME,
} from '../core/Config';
import { Block } from './ObstacleTypes';

/**
 * Fairness solver.
 *
 * Every obstacle pattern is proved traversable *before* it is placed in
 * the world. We discretise the pattern into a lane-occupancy grid, then
 * run a breadth-first reachability search over the player's real state
 * space — (lane, posture, lane-transition) — using the same physics
 * constants the player controller uses.
 *
 * A pattern ships only if a path exists from *every* starting lane, so
 * it is winnable regardless of where the player happens to be when it
 * arrives. If no path exists at the current speed, the generator picks
 * something else.
 */

export const GRID_SLICE = 0.25; // metres per occupancy cell

/** Air-time window (as a fraction of the jump) during which the feet
 *  clear a low hazard, derived from the actual jump arc. */
const JUMP_WINDOW = computeJumpWindow(0.95);
/** Slide window during which the head is genuinely below a high hazard. */
const SLIDE_WINDOW = { start: 0.16, end: 0.84 };

const AIR_TIME = (2 * JUMP_VELOCITY) / GRAVITY;

function computeJumpWindow(clearance: number): { start: number; end: number } {
  // y(t) = v0·t − ½g·t²  ⇒  solve y(t) = clearance
  const disc = JUMP_VELOCITY * JUMP_VELOCITY - 2 * GRAVITY * clearance;
  if (disc <= 0) return { start: 0.5, end: 0.5 };
  const root = Math.sqrt(disc);
  const t1 = (JUMP_VELOCITY - root) / GRAVITY;
  const t2 = (JUMP_VELOCITY + root) / GRAVITY;
  const total = (2 * JUMP_VELOCITY) / GRAVITY;
  // Shrink 12% inward: the solver must be stricter than the collider.
  const pad = (t2 - t1) * 0.12;
  return { start: (t1 + pad) / total, end: (t2 - pad) / total };
}

export const SOLVER_STEP = 0.02; // seconds per simulation step

export interface SolverState {
  lane: number;
  /** Frames of jump remaining (0 when grounded). */
  airFrames: number;
  /** Frames of slide remaining (0 when upright). */
  slideFrames: number;
}

export interface OccupancyGrid {
  /** slices × LANE_COUNT, values are `Block`. */
  cells: Uint8Array;
  slices: number;
  length: number;
}

export function createGrid(length: number): OccupancyGrid {
  const slices = Math.max(1, Math.ceil(length / GRID_SLICE));
  return { cells: new Uint8Array(slices * LANE_COUNT), slices, length };
}

/** Marks [zStart, zEnd] of `lane` with at least `block`. */
export function markGrid(
  grid: OccupancyGrid,
  lane: number,
  zStart: number,
  zEnd: number,
  block: Block,
): void {
  if (lane < 0 || lane >= LANE_COUNT) return;
  const from = Math.max(0, Math.floor(zStart / GRID_SLICE));
  const to = Math.min(grid.slices - 1, Math.ceil(zEnd / GRID_SLICE));
  for (let s = from; s <= to; s++) {
    const i = s * LANE_COUNT + lane;
    if (grid.cells[i] < block) grid.cells[i] = block;
  }
}

/**
 * Breadth-first reachability over (lane × posture × transition).
 *
 * Posture index: 0 = grounded, 1..A = air-frames remaining,
 * A+1..A+S = slide-frames remaining. Air and slide are mutually
 * exclusive, which keeps the state space at a few thousand entries.
 */
/**
 * @param lockSteps  Number of leading steps during which no action may
 *   be started. Answering "can I survive if I do nothing for the next
 *   N steps?" is what lets a planner know it must act *now* rather than
 *   discovering at the last frame that it should have acted already.
 */
export function isTraversable(
  grid: OccupancyGrid,
  speed: number,
  startLane?: number,
  start?: SolverState,
  lockSteps = 0,
): boolean {
  const STEP = SOLVER_STEP;
  const airFrames = Math.max(1, Math.round(AIR_TIME / STEP));
  const slideFrames = Math.max(1, Math.round(SLIDE_TIME / STEP));
  const switchFrames = Math.max(1, Math.round(LANE_CHANGE_TIME / STEP));

  // Posture index: 0 = grounded · 1..A = air frames left · A+1..A+S = slide.
  const P = 1 + airFrames + slideFrames;
  // Transition index: 0 = settled · else origin-lane × frames remaining.
  const W = 1 + LANE_COUNT * switchFrames;
  const SIZE = LANE_COUNT * P * W;

  // Clearance lookup per posture, computed once instead of per state.
  const clearsLow = new Uint8Array(P);
  const clearsHigh = new Uint8Array(P);
  for (let air = 1; air <= airFrames; air++) {
    const t = (airFrames - air) / airFrames;
    clearsLow[air] = t >= JUMP_WINDOW.start && t <= JUMP_WINDOW.end ? 1 : 0;
  }
  for (let slide = 1; slide <= slideFrames; slide++) {
    const t = (slideFrames - slide) / slideFrames;
    clearsHigh[airFrames + slide] = t >= SLIDE_WINDOW.start && t <= SLIDE_WINDOW.end ? 1 : 0;
  }

  const buffers = getBuffers(SIZE);
  const { frontier, nextFrontier, seen } = buffers;

  // Encode the caller's posture (mid-jump / mid-slide) as a start state.
  let posture0 = 0;
  if (start) {
    if (start.airFrames > 0) posture0 = Math.min(airFrames, start.airFrames);
    else if (start.slideFrames > 0) posture0 = airFrames + Math.min(slideFrames, start.slideFrames);
  }

  const totalTime = grid.length / speed;
  const steps = Math.ceil(totalTime / STEP);
  const lanes = startLane === undefined ? ALL_LANES : [startLane];

  for (const lane0 of lanes) {
    let count = 1;
    frontier[0] = (lane0 * P + posture0) * W + 0;

    for (let step = 0; step <= steps; step++) {
      const slice = Math.min(grid.slices - 1, Math.floor((speed * step * STEP) / GRID_SLICE));
      const base = slice * LANE_COUNT;
      const stamp = ++buffers.stamp;
      const locked = step < lockSteps;
      let nextCount = 0;

      for (let i = 0; i < count; i++) {
        const state = frontier[i];
        const sw = state % W;
        const rest = (state - sw) / W;
        const posture = rest % P;
        const lane = (rest - posture) / P;

        const low = clearsLow[posture] === 1;
        const high = clearsHigh[posture] === 1;

        // The body must survive every lane it currently overlaps.
        if (!passable(grid.cells[base + lane], low, high)) continue;
        let fromLane = -1;
        if (sw > 0) {
          fromLane = ((sw - 1) / switchFrames) | 0;
          if (!passable(grid.cells[base + fromLane], low, high)) continue;
        }

        // Advance timers by one frame.
        const swRem = sw > 0 ? (sw - 1) % switchFrames : 0;
        const nextSw = swRem > 0 ? fromLane * switchFrames + swRem : 0;
        let nextPosture = 0;
        if (posture >= 1 && posture <= airFrames) {
          nextPosture = posture > 1 ? posture - 1 : 0;
        } else if (posture > airFrames) {
          nextPosture = posture > airFrames + 1 ? posture - 1 : 0;
        }

        const laneBase = lane * P;
        // Coast.
        let idx = (laneBase + nextPosture) * W + nextSw;
        if (seen[idx] !== stamp) { seen[idx] = stamp; nextFrontier[nextCount++] = idx; }

        if (locked) continue;

        // Start a jump or a slide (only from a settled posture).
        if (nextPosture === 0) {
          idx = (laneBase + airFrames) * W + nextSw;
          if (seen[idx] !== stamp) { seen[idx] = stamp; nextFrontier[nextCount++] = idx; }
          idx = (laneBase + airFrames + slideFrames) * W + nextSw;
          if (seen[idx] !== stamp) { seen[idx] = stamp; nextFrontier[nextCount++] = idx; }
        }

        // Start a lane change; the body overlaps the origin lane until
        // the transition completes.
        if (nextSw === 0) {
          const overlap = switchFrames > 1 ? lane * switchFrames + switchFrames - 1 : 0;
          if (lane > 0) {
            idx = ((lane - 1) * P + nextPosture) * W + overlap;
            if (seen[idx] !== stamp) { seen[idx] = stamp; nextFrontier[nextCount++] = idx; }
          }
          if (lane < LANE_COUNT - 1) {
            idx = ((lane + 1) * P + nextPosture) * W + overlap;
            if (seen[idx] !== stamp) { seen[idx] = stamp; nextFrontier[nextCount++] = idx; }
          }
        }
      }

      if (nextCount === 0) return false;
      frontier.set(nextFrontier.subarray(0, nextCount));
      count = nextCount;
    }
  }
  return true;
}

const ALL_LANES = [0, 1, 2];

/**
 * Scratch buffers reused across solver calls. The generator runs this
 * mid-game, so it must not allocate.
 */
interface SolverBuffers {
  frontier: Int32Array;
  nextFrontier: Int32Array;
  seen: Int32Array;
  stamp: number;
}
let buffers: SolverBuffers | null = null;

function getBuffers(size: number): SolverBuffers {
  if (!buffers || buffers.seen.length < size) {
    buffers = {
      frontier: new Int32Array(size),
      nextFrontier: new Int32Array(size),
      seen: new Int32Array(size),
      stamp: 0,
    };
  }
  return buffers;
}

function passable(cell: number, clearsLow: boolean, clearsHigh: boolean): boolean {
  switch (cell) {
    case Block.None: return true;
    case Block.Low: return clearsLow;
    case Block.High: return clearsHigh;
    default: return false;
  }
}
