import { ObstacleType } from './ObstacleTypes';

export interface PatternObstacle {
  type: ObstacleType;
  /** Anchor lane (0 = left, 1 = centre, 2 = right). */
  lane: number;
  /** Distance from the start of the pattern, in metres. */
  z: number;
}

export interface CoinTrail {
  lane: number;
  /** Interpolate to this lane across the trail for a diagonal path. */
  laneEnd?: number;
  z: number;
  count: number;
  gap?: number;
  /** flat = ground line · arc = jump arc · high = only reachable airborne */
  shape?: 'flat' | 'arc' | 'high';
}

export interface Pattern {
  id: string;
  /** Total length in metres. */
  length: number;
  /** Lowest difficulty tier that may spawn this. */
  tier: number;
  /** Highest tier that still spawns it (keeps trivial patterns from
   *  diluting late-game difficulty). */
  maxTier?: number;
  weight: number;
  obstacles: PatternObstacle[];
  coins?: CoinTrail[];
}

/**
 * The authored vocabulary of the game. Every entry is verified by the
 * path solver at the speed it will actually be played at, so this list
 * is a set of *proposals* — the generator only ships what passes.
 *
 * Design intent per tier:
 *   0 — teach one verb at a time (jump / slide / dodge)
 *   1 — chain two verbs, introduce two-lane blockers
 *   2 — forced actions, moving hazards, long blockers
 *   3 — combinations with overlapping timing windows
 *   4 — corridors and stacked hazards, minimal slack
 */
export const PATTERNS: Pattern[] = [
  // ── Tier 0 · single verbs ─────────────────────────────────────────
  {
    id: 'intro-hurdle', length: 14, tier: 0, maxTier: 2, weight: 10,
    obstacles: [{ type: 'hurdle', lane: 1, z: 6 }],
    coins: [{ lane: 1, z: 2.5, count: 6, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'intro-beam', length: 14, tier: 0, maxTier: 2, weight: 10,
    obstacles: [{ type: 'beam', lane: 1, z: 6 }],
    coins: [{ lane: 1, z: 2, count: 7, gap: 1.4 }],
  },
  {
    id: 'intro-pylon', length: 14, tier: 0, maxTier: 2, weight: 9,
    obstacles: [{ type: 'pylon', lane: 1, z: 6 }],
    coins: [
      { lane: 0, z: 4, count: 4, gap: 1.4 },
      { lane: 2, z: 4, count: 4, gap: 1.4 },
    ],
  },
  {
    id: 'intro-pinch', length: 16, tier: 0, maxTier: 3, weight: 8,
    obstacles: [
      { type: 'pylon', lane: 0, z: 6 },
      { type: 'pylon', lane: 2, z: 6 },
    ],
    coins: [{ lane: 1, z: 2, count: 8, gap: 1.4 }],
  },
  {
    id: 'intro-side-hurdles', length: 16, tier: 0, maxTier: 3, weight: 8,
    obstacles: [
      { type: 'hurdle', lane: 0, z: 6 },
      { type: 'hurdle', lane: 2, z: 6 },
    ],
    coins: [{ lane: 1, z: 3, count: 7, gap: 1.4 }],
  },

  // ── Tier 1 · two-lane blockers and short chains ──────────────────
  // Two-lane walls sit deep in the pattern: crossing from the far lane
  // costs two lane changes, and at top speed that needs ~10 m of runway.
  {
    id: 'wall-left', length: 24, tier: 1, weight: 9,
    obstacles: [{ type: 'barrier2', lane: 0, z: 13 }],
    coins: [{ lane: 1, laneEnd: 2, z: 2, count: 7, gap: 1.5 }],
  },
  {
    id: 'wall-right', length: 24, tier: 1, weight: 9,
    obstacles: [{ type: 'barrier2', lane: 1, z: 13 }],
    coins: [{ lane: 1, laneEnd: 0, z: 2, count: 7, gap: 1.5 }],
  },
  {
    id: 'hurdle-run', length: 28, tier: 1, weight: 8,
    obstacles: [
      { type: 'hurdle', lane: 1, z: 6 },
      { type: 'hurdle', lane: 1, z: 14 },
      { type: 'hurdle', lane: 1, z: 22 },
    ],
    coins: [
      { lane: 1, z: 3, count: 5, gap: 1.4, shape: 'arc' },
      { lane: 1, z: 11, count: 5, gap: 1.4, shape: 'arc' },
      { lane: 1, z: 19, count: 5, gap: 1.4, shape: 'arc' },
    ],
  },
  {
    id: 'duck-then-hop', length: 24, tier: 1, weight: 8,
    obstacles: [
      { type: 'beam', lane: 1, z: 6 },
      { type: 'hurdle', lane: 1, z: 16 },
    ],
    coins: [{ lane: 1, z: 2, count: 5, gap: 1.4 }, { lane: 1, z: 13, count: 5, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'weave-three', length: 32, tier: 1, weight: 8,
    obstacles: [
      { type: 'pylon', lane: 0, z: 6 },
      { type: 'pylon', lane: 1, z: 16 },
      { type: 'pylon', lane: 2, z: 26 },
    ],
    coins: [{ lane: 2, laneEnd: 0, z: 10, count: 8, gap: 1.6 }],
  },
  {
    id: 'wide-hop', length: 20, tier: 1, weight: 7,
    obstacles: [{ type: 'hurdleWide', lane: 0, z: 7 }],
    coins: [{ lane: 0, z: 4, count: 5, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'wide-hop-right', length: 20, tier: 1, weight: 7,
    obstacles: [{ type: 'hurdleWide', lane: 1, z: 7 }],
    coins: [{ lane: 2, z: 4, count: 5, gap: 1.4, shape: 'arc' }],
  },

  // ── Tier 2 · forced actions and moving hazards ────────────────────
  {
    id: 'forced-slide', length: 22, tier: 2, weight: 8,
    obstacles: [
      { type: 'beamWide', lane: 1, z: 8 },
      { type: 'pylon', lane: 0, z: 8 },
    ],
    coins: [{ lane: 2, z: 3, count: 8, gap: 1.4 }],
  },
  {
    id: 'forced-slide-mirror', length: 22, tier: 2, weight: 8,
    obstacles: [
      { type: 'beamWide', lane: 0, z: 8 },
      { type: 'pylon', lane: 2, z: 8 },
    ],
    coins: [{ lane: 0, z: 3, count: 8, gap: 1.4 }],
  },
  {
    id: 'crate-slalom', length: 38, tier: 2, weight: 8,
    obstacles: [
      { type: 'crate', lane: 0, z: 6 },
      { type: 'crate', lane: 2, z: 15 },
      { type: 'crate', lane: 0, z: 24 },
      { type: 'crate', lane: 2, z: 33 },
    ],
    coins: [{ lane: 1, z: 4, count: 16, gap: 1.9 }],
  },
  {
    id: 'freight-left', length: 32, tier: 2, weight: 8,
    obstacles: [
      { type: 'freight', lane: 0, z: 14 },
      { type: 'hurdle', lane: 1, z: 8 },
    ],
    coins: [{ lane: 2, z: 6, count: 10, gap: 1.7 }],
  },
  {
    id: 'freight-right', length: 32, tier: 2, weight: 8,
    obstacles: [
      { type: 'freight', lane: 2, z: 14 },
      { type: 'hurdle', lane: 1, z: 8 },
    ],
    coins: [{ lane: 0, z: 6, count: 10, gap: 1.7 }],
  },
  {
    id: 'double-wall', length: 42, tier: 2, weight: 7,
    obstacles: [
      { type: 'barrier2', lane: 0, z: 13 },
      { type: 'barrier2', lane: 1, z: 30 },
    ],
    coins: [{ lane: 2, laneEnd: 0, z: 17, count: 8, gap: 1.5 }],
  },
  {
    id: 'hop-duck-wide', length: 30, tier: 2, weight: 7,
    obstacles: [
      { type: 'hurdleWide', lane: 0, z: 8 },
      { type: 'beamWide', lane: 1, z: 20 },
    ],
    coins: [{ lane: 0, z: 5, count: 5, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'drone-patrol', length: 26, tier: 2, weight: 7,
    obstacles: [{ type: 'drone', lane: 0, z: 11 }],
    coins: [{ lane: 2, z: 5, count: 9, gap: 1.6 }],
  },
  {
    id: 'drone-patrol-right', length: 26, tier: 2, weight: 7,
    obstacles: [{ type: 'drone', lane: 1, z: 11 }],
    coins: [{ lane: 0, z: 5, count: 9, gap: 1.6 }],
  },

  // ── Tier 3 · combinations ─────────────────────────────────────────
  {
    id: 'sweeper-duck', length: 26, tier: 3, weight: 8,
    obstacles: [{ type: 'sweeper', lane: 1, z: 10 }],
    coins: [{ lane: 1, z: 4, count: 10, gap: 1.5 }],
  },
  {
    id: 'gauntlet', length: 42, tier: 3, weight: 8,
    obstacles: [
      { type: 'hurdle', lane: 1, z: 6 },
      { type: 'pylon', lane: 0, z: 15 },
      { type: 'beam', lane: 1, z: 24 },
      { type: 'pylon', lane: 2, z: 33 },
    ],
    coins: [{ lane: 1, z: 3, count: 5, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'freight-corridor', length: 36, tier: 3, weight: 7,
    obstacles: [
      { type: 'freight', lane: 1, z: 16 },
      { type: 'hurdle', lane: 0, z: 8 },
      { type: 'hurdle', lane: 2, z: 8 },
    ],
    coins: [
      { lane: 0, z: 12, count: 7, gap: 1.7 },
      { lane: 2, z: 12, count: 7, gap: 1.7 },
    ],
  },
  {
    id: 'coin-bait-weave', length: 34, tier: 3, weight: 7,
    obstacles: [
      { type: 'pylon', lane: 0, z: 6 },
      { type: 'pylon', lane: 2, z: 13 },
      { type: 'pylon', lane: 0, z: 20 },
      { type: 'pylon', lane: 2, z: 27 },
    ],
    coins: [
      { lane: 2, z: 5, count: 3, gap: 1.5 },
      { lane: 0, z: 12, count: 3, gap: 1.5 },
      { lane: 2, z: 19, count: 3, gap: 1.5 },
      { lane: 0, z: 26, count: 3, gap: 1.5 },
    ],
  },
  {
    id: 'twin-drones', length: 42, tier: 3, weight: 6,
    obstacles: [
      { type: 'drone', lane: 0, z: 11 },
      { type: 'drone', lane: 1, z: 28 },
    ],
    coins: [{ lane: 2, laneEnd: 0, z: 16, count: 8, gap: 1.6 }],
  },
  {
    id: 'wall-then-sweep', length: 42, tier: 3, weight: 6,
    obstacles: [
      { type: 'barrier2', lane: 1, z: 13 },
      { type: 'sweeper', lane: 1, z: 30 },
    ],
    coins: [{ lane: 0, z: 17, count: 8, gap: 1.5 }],
  },
  {
    id: 'stack-hop', length: 30, tier: 3, weight: 6,
    obstacles: [
      { type: 'hurdleWide', lane: 0, z: 9 },
      { type: 'crate', lane: 2, z: 9 },
      { type: 'beam', lane: 1, z: 21 },
    ],
    coins: [{ lane: 1, z: 6, count: 5, gap: 1.4, shape: 'arc' }],
  },

  // ── Tier 4 · corridors and stacks ─────────────────────────────────
  {
    id: 'tunnel-run', length: 40, tier: 4, weight: 8,
    obstacles: [
      { type: 'freight', lane: 0, z: 16 },
      { type: 'freight', lane: 2, z: 16 },
      { type: 'hurdle', lane: 1, z: 16 },
    ],
    coins: [{ lane: 1, z: 13, count: 5, gap: 1.4, shape: 'arc' }],
  },
  {
    id: 'double-sweep', length: 44, tier: 4, weight: 7,
    obstacles: [
      { type: 'sweeper', lane: 1, z: 9 },
      { type: 'pylon', lane: 1, z: 22 },
      { type: 'sweeper', lane: 1, z: 34 },
    ],
    coins: [{ lane: 0, z: 18, count: 6, gap: 1.6 }],
  },
  {
    id: 'storm', length: 46, tier: 4, weight: 7,
    obstacles: [
      { type: 'hurdle', lane: 1, z: 6 },
      { type: 'barrier2', lane: 0, z: 16 },
      { type: 'beamWide', lane: 1, z: 28 },
      { type: 'pylon', lane: 0, z: 38 },
    ],
    coins: [{ lane: 2, z: 20, count: 6, gap: 1.6 }],
  },
  {
    id: 'lattice', length: 44, tier: 4, weight: 6,
    obstacles: [
      { type: 'beamWide', lane: 0, z: 8 },
      { type: 'hurdle', lane: 2, z: 8 },
      { type: 'crate', lane: 1, z: 20 },
      { type: 'beamWide', lane: 1, z: 32 },
      { type: 'hurdle', lane: 0, z: 32 },
    ],
    coins: [{ lane: 2, laneEnd: 0, z: 24, count: 6, gap: 1.5 }],
  },

  // ── Reward runs · no hazards, pure coin lines ────────────────────
  {
    id: 'reward-line', length: 22, tier: 0, weight: 5,
    obstacles: [],
    coins: [{ lane: 1, z: 2, count: 12, gap: 1.6 }],
  },
  {
    id: 'reward-slalom', length: 30, tier: 1, weight: 5,
    obstacles: [],
    coins: [
      { lane: 0, laneEnd: 2, z: 2, count: 9, gap: 1.6 },
      { lane: 2, laneEnd: 0, z: 17, count: 8, gap: 1.6 },
    ],
  },
  {
    id: 'reward-air', length: 24, tier: 2, weight: 4,
    obstacles: [{ type: 'hurdle', lane: 1, z: 8 }],
    coins: [{ lane: 1, z: 4, count: 8, gap: 1.5, shape: 'arc' }],
  },
];
