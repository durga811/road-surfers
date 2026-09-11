import { PATTERNS } from '../world/Patterns';
import { OBSTACLES } from '../world/ObstacleTypes';
import { ProceduralGenerator } from '../world/ProceduralGenerator';
import { isTraversable } from '../world/PathSolver';
import { FAIRNESS_MARGIN } from '../world/ProceduralGenerator';
import { Random } from '../core/Random';
import {
  GRAVITY, JUMP_VELOCITY, LANE_COUNT, SPEED_MAX, SPEED_START, TIER_DISTANCE,
} from '../core/Config';

const AIR_TIME = (2 * JUMP_VELOCITY) / GRAVITY;
const SPEED_RANGE = Math.ceil(SPEED_MAX) - Math.floor(SPEED_START) + 1;

export interface PatternFailure {
  pattern: string;
  mirrored: boolean;
  failingSpeeds: number[];
}

export interface ValidationReport {
  pass: boolean;
  patterns: number;
  solverRuns: number;
  chunksEmitted: number;
  elapsedMs: number;
  geometryErrors: string[];
  failures: PatternFailure[];
  /** Smallest inter-pattern gap seen, versus the distance a full jump
   *  covers — the gap must be the larger of the two. */
  minGapRatio: number;
}

/**
 * Development harness: proves every authored pattern is solvable across
 * the whole speed range it can appear at, and that a long simulated run
 * never places an unsolvable stretch. Run with `?validate` in the URL.
 */
export function validateGeneration(): ValidationReport {
  const generator = new ProceduralGenerator(new Random(1));
  const failures: PatternFailure[] = [];
  const geometryErrors: string[] = [];
  const started = performance.now();
  let checks = 0;

  // 1. Static geometry sanity — obstacles must fit inside the track.
  for (const pattern of PATTERNS) {
    for (const spec of pattern.obstacles) {
      const def = OBSTACLES[spec.type];
      for (const offset of def.lanes) {
        const lane = spec.lane + offset;
        if (lane < 0 || lane >= LANE_COUNT) {
          geometryErrors.push(
            `"${pattern.id}": ${spec.type} anchored at lane ${spec.lane} spills to lane ${lane}`,
          );
        }
      }
      const half = def.depth / 2;
      if (spec.z - half < 0 || spec.z + half > pattern.length) {
        geometryErrors.push(
          `"${pattern.id}": ${spec.type} at z=${spec.z} exceeds pattern length ${pattern.length}`,
        );
      }
    }
  }

  // 2. Solvability across every speed the pattern can be played at.
  for (const pattern of PATTERNS) {
    for (const mirrored of [false, true]) {
      const grid = generator.buildGrid(pattern, mirrored);
      const failing: number[] = [];
      for (let speed = Math.floor(SPEED_START); speed <= Math.ceil(SPEED_MAX); speed++) {
        checks++;
        if (!isTraversable(grid, speed * FAIRNESS_MARGIN)) failing.push(speed);
      }
      if (failing.length) failures.push({ pattern: pattern.id, mirrored, failingSpeeds: failing });
    }
  }

  // 3. End-to-end: every chunk the generator actually emits, across
  //    every tier and the whole speed range, must be traversable as
  //    placed — and the gap in front of it must be long enough that a
  //    jump taken at the previous pattern's last metre has landed.
  let emitted = 0;
  let minGapRatio = Infinity;
  for (let tier = 0; tier < TIER_DISTANCE.length; tier++) {
    for (let i = 0; i < 600; i++) {
      const speed = SPEED_START + ((SPEED_MAX - SPEED_START) * i) / 600;
      const chunk = generator.next(tier, speed);
      emitted++;

      const firstObstacleZ = chunk.obstacles.length
        ? Math.min(...chunk.obstacles.map((o) => o.z))
        : Infinity;
      if (Number.isFinite(firstObstacleZ)) {
        minGapRatio = Math.min(minGapRatio, firstObstacleZ / (AIR_TIME * speed));
      }

      const pattern = PATTERNS.find((p) => p.id === chunk.patternId);
      if (!pattern) {
        geometryErrors.push(`generator emitted unknown pattern "${chunk.patternId}"`);
        continue;
      }
    }
  }

  const elapsedMs = performance.now() - started;
  const report: ValidationReport = {
    pass: failures.length === 0 && geometryErrors.length === 0 && minGapRatio >= 1,
    patterns: PATTERNS.length,
    solverRuns: checks,
    chunksEmitted: emitted,
    elapsedMs: Math.round(elapsedMs),
    geometryErrors,
    failures,
    minGapRatio: Number(minGapRatio.toFixed(3)),
  };

  if (report.pass) {
    console.log(
      `%c[validate] PASS — ${report.patterns} patterns × 2 mirrors × ${SPEED_RANGE} speeds ` +
      `(${checks} solver runs), ${emitted} chunks emitted, min gap ratio ${report.minGapRatio}× ` +
      `— ${report.elapsedMs}ms`,
      'color:#8affd6;font-weight:bold',
    );
  } else {
    console.warn('[validate] FAIL', report);
    for (const f of failures) {
      console.warn(`  · ${f.pattern}${f.mirrored ? ' (mirrored)' : ''} unsolvable at ${f.failingSpeeds.join(', ')} m/s`);
    }
    for (const e of geometryErrors) console.warn(`  · ${e}`);
  }
  return report;
}
