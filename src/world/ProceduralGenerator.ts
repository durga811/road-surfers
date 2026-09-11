import { Random } from '../core/Random';
import { GRAVITY, JUMP_VELOCITY, LANE_COUNT, PLAYER_HALF_DEPTH } from '../core/Config';
import { CoinTrail, Pattern, PATTERNS } from './Patterns';
import { OBSTACLES, ObstacleType } from './ObstacleTypes';
import { createGrid, isTraversable, markGrid, OccupancyGrid } from './PathSolver';
import { COIN_Y } from '../core/Config';

export interface PlacedObstacle {
  type: ObstacleType;
  lane: number;
  /** Distance from the start of the generated chunk. */
  z: number;
}

export interface PlacedCoin {
  lane: number;
  z: number;
  y: number;
}

export type PowerUpKind = 'magnet' | 'shield' | 'surge';

export interface GeneratedChunk {
  patternId: string;
  /** Total advance, including the reaction gap that precedes the pattern. */
  length: number;
  obstacles: PlacedObstacle[];
  coins: PlacedCoin[];
  powerUp: { kind: PowerUpKind; lane: number; z: number } | null;
}

/** Reaction time granted before each pattern, per difficulty tier. */
const REACTION_TIME = [0.95, 0.82, 0.7, 0.6, 0.52];
/** Extra breathing room (metres) so patterns never visually merge. */
const MIN_GAP = 8;
/**
 * A jump taken at the previous pattern's last metre must have landed
 * before the next pattern begins — otherwise the player could enter a
 * validated pattern airborne, which is a state the solver does not
 * model. Enforcing this at the gap keeps the per-pattern proof valid
 * for the composition of patterns.
 */
const AIR_TIME = (2 * JUMP_VELOCITY) / GRAVITY;

/**
 * Patterns are proved solvable at this multiple of the actual speed,
 * so every one of them carries spare distance rather than being
 * frame-perfect. A pattern that only just works for a machine is not
 * fair to a person.
 */
export const FAIRNESS_MARGIN = 1.14;

const POWER_UPS: PowerUpKind[] = ['magnet', 'shield', 'surge'];

/**
 * Chooses the next stretch of track.
 *
 * The generator never trusts a pattern: each candidate (and its mirror)
 * is compiled into an occupancy grid and proved traversable by the path
 * solver at the *current* speed before it can be placed. Results are
 * memoised per (pattern, mirrored, speed bucket) so the cost is paid
 * once per combination rather than once per spawn.
 */
export class ProceduralGenerator {
  private readonly rng: Random;
  private readonly solvable = new Map<string, boolean>();
  private lastPatternId = '';
  private sincePowerUp = 0;

  constructor(rng: Random) {
    this.rng = rng;
  }

  reset(): void {
    this.lastPatternId = '';
    this.sincePowerUp = 0;
  }

  next(tier: number, speed: number): GeneratedChunk {
    const reaction = REACTION_TIME[Math.min(tier, REACTION_TIME.length - 1)];
    const gap = Math.max(MIN_GAP, speed * reaction, speed * AIR_TIME);
    const candidates = PATTERNS.filter(
      (p) => p.tier <= tier && (p.maxTier === undefined || tier <= p.maxTier),
    );

    // Try a handful of weighted picks, then fall back to a pattern that
    // is trivially safe. The fallback exists so the world can never
    // stall, even if every candidate somehow fails validation.
    for (let attempt = 0; attempt < 8; attempt++) {
      const pattern = this.rng.weighted(candidates, (p) =>
        p.id === this.lastPatternId ? p.weight * 0.15 : p.weight,
      );
      const mirrored = this.rng.chance(0.5);
      if (!this.validate(pattern, mirrored, speed)) continue;
      this.lastPatternId = pattern.id;
      return this.build(pattern, mirrored, gap, tier);
    }

    const safe = PATTERNS.find((p) => p.id === 'reward-line')!;
    this.lastPatternId = safe.id;
    return this.build(safe, false, gap, tier);
  }

  // ── Validation ────────────────────────────────────────────────────

  private validate(pattern: Pattern, mirrored: boolean, speed: number): boolean {
    const bucket = Math.round(speed);
    const key = `${pattern.id}|${mirrored ? 'm' : 'n'}|${bucket}`;
    const cached = this.solvable.get(key);
    if (cached !== undefined) return cached;

    const grid = this.buildGrid(pattern, mirrored);
    const ok = isTraversable(grid, bucket * FAIRNESS_MARGIN);
    this.solvable.set(key, ok);
    return ok;
  }

  /** Compiles a pattern into the lane-occupancy grid the solver reads. */
  buildGrid(pattern: Pattern, mirrored: boolean): OccupancyGrid {
    const grid = createGrid(pattern.length);
    for (const spec of pattern.obstacles) {
      const def = OBSTACLES[spec.type];
      const lane = mirrorAnchor(spec.lane, def.lanes, mirrored);
      const half = def.depth / 2 + PLAYER_HALF_DEPTH;
      for (const offset of def.lanes) {
        markGrid(grid, lane + offset, spec.z - half, spec.z + half, def.block);
      }
    }
    return grid;
  }

  // ── Placement ─────────────────────────────────────────────────────

  private build(pattern: Pattern, mirrored: boolean, gap: number, tier: number): GeneratedChunk {
    const obstacles: PlacedObstacle[] = [];
    for (const spec of pattern.obstacles) {
      const def = OBSTACLES[spec.type];
      obstacles.push({
        type: spec.type,
        lane: mirrorAnchor(spec.lane, def.lanes, mirrored),
        z: gap + spec.z,
      });
    }

    const coins: PlacedCoin[] = [];
    for (const trail of pattern.coins ?? []) {
      expandTrail(trail, mirrored, gap, coins);
    }

    // Ambient coins fill long empty lead-ins so the track never reads
    // as dead space between patterns.
    if (gap > 13 && this.rng.chance(0.55)) {
      const lane = this.rng.int(0, LANE_COUNT);
      const count = Math.floor((gap - 8) / 1.7);
      for (let i = 0; i < count; i++) {
        coins.push({ lane, z: 3 + i * 1.7, y: COIN_Y });
      }
    }

    // Power-ups live in the reaction gap, which is guaranteed clear.
    this.sincePowerUp++;
    let powerUp: GeneratedChunk['powerUp'] = null;
    const due = this.sincePowerUp >= (tier >= 2 ? 5 : 7);
    if (due && this.rng.chance(0.55)) {
      this.sincePowerUp = 0;
      powerUp = {
        kind: this.rng.pick(POWER_UPS),
        lane: this.rng.int(0, LANE_COUNT),
        z: gap * 0.5,
      };
    }

    return { patternId: pattern.id, length: gap + pattern.length, obstacles, coins, powerUp };
  }
}

/**
 * Mirrors an anchor lane so that the mirrored obstacle occupies the
 * reflected set of lanes. Works for any contiguous lane span.
 */
function mirrorAnchor(lane: number, offsets: readonly number[], mirrored: boolean): number {
  if (!mirrored) return lane;
  let min = offsets[0];
  let max = offsets[0];
  for (const o of offsets) {
    if (o < min) min = o;
    if (o > max) max = o;
  }
  return LANE_COUNT - 1 - lane - max - min;
}

function expandTrail(trail: CoinTrail, mirrored: boolean, gap: number, out: PlacedCoin[]): void {
  const gapZ = trail.gap ?? 1.6;
  const startLane = mirrored ? LANE_COUNT - 1 - trail.lane : trail.lane;
  const endLaneRaw = trail.laneEnd ?? trail.lane;
  const endLane = mirrored ? LANE_COUNT - 1 - endLaneRaw : endLaneRaw;

  for (let i = 0; i < trail.count; i++) {
    const t = trail.count === 1 ? 0 : i / (trail.count - 1);
    const lane = startLane + (endLane - startLane) * t;
    let y = COIN_Y;
    if (trail.shape === 'arc') {
      // Follows the jump arc so the reward lines up with the input.
      y = COIN_Y + Math.sin(t * Math.PI) * 1.05;
    } else if (trail.shape === 'high') {
      y = COIN_Y + 1.1;
    }
    out.push({ lane, z: gap + trail.z + i * gapZ, y });
  }
}
