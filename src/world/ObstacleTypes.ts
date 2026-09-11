import * as THREE from 'three';
import { Mat } from '../render/Materials';
import { PartBuilder } from '../render/PartBuilder';
import { LANE_COUNT, LANE_WIDTH, LANE_X } from '../core/Config';

/**
 * How an obstacle blocks a lane. This is the single vocabulary shared
 * by the mesh builders, the collision system and the fairness solver —
 * they can never disagree about what is passable.
 */
export const enum Block {
  None = 0,
  Low = 1,   // jump over
  High = 2,  // slide under
  Full = 3,  // change lane
}

export type ObstacleType =
  | 'hurdle' | 'hurdleWide'
  | 'beam' | 'beamWide'
  | 'pylon' | 'crate'
  | 'barrier2' | 'freight'
  | 'drone' | 'sweeper';

export interface ObstacleDef {
  readonly type: ObstacleType;
  readonly block: Block;
  /** Lane offsets occupied, relative to the anchor lane. */
  readonly lanes: readonly number[];
  readonly width: number;
  readonly depth: number;
  readonly minY: number;
  readonly maxY: number;
  /** Lateral patrol amplitude in lanes (moving hazards only). */
  readonly motion?: 'patrol' | 'sweep';
  readonly build: () => THREE.Object3D;
}

// ── Shared construction helpers ──────────────────────────────────────

const TRACK_SPAN = LANE_WIDTH * 2 + 3.4;

/**
 * Every hazard speaks the same visual language: a near-black chassis
 * with coral emissive banding, plus a chevron on the face the player
 * sees first. The chevron *is* the instruction — up means jump, down
 * means slide, sideways means change lane — so the required verb is
 * legible from sixty metres out, long before the shape itself is.
 */

/** Arrow built from two angled bars, drawn on the approach face. */
function chevron(
  b: PartBuilder,
  direction: 'up' | 'down' | 'left' | 'right',
  size: number,
  x: number, y: number, z: number,
): void {
  const arm = size * 0.72;
  const thickness = size * 0.2;
  const tilt = Math.PI / 4;
  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? 1 : -1;
  const spread = size * 0.26;

  for (const side of [-1, 1]) {
    // Outer ends fall away from the tip, so the two bars meet in a
    // point aimed at `direction`.
    const angle = -side * tilt * sign;
    if (vertical) {
      b.box(Mat.hazardWarn, arm, thickness, 0.05, x + side * spread, y, z, { z: angle });
    } else {
      b.box(Mat.hazardWarn, thickness, arm, 0.05, x, y + side * spread, z, { z: angle });
    }
  }
}
function buildHurdle(width: number): THREE.Object3D {
  const b = new PartBuilder();
  b.box(Mat.hazardBody, width, 0.16, 0.42, 0, 0.82);
  b.box(Mat.hazardStripe, width - 0.06, 0.06, 0.46, 0, 0.82);
  for (const s of [-1, 1]) {
    b.box(Mat.hazardBody, 0.12, 0.86, 0.12, s * (width / 2 - 0.12), 0.43);
  }
  b.box(Mat.hazardBody, width, 0.07, 0.5, 0, 0.035);
  // Lit stripe on the top edge + an up-chevron: go over.
  const arrows = width > 3 ? [-1.1, 1.1] : [0];
  for (const x of arrows) chevron(b, 'up', 0.44, x, 0.86, 0.25);
  return b.build(`hurdle:${width}`);
}

function buildBeam(width: number): THREE.Object3D {
  const b = new PartBuilder();
  // Overhead mass on a gantry — the lit underside reads as "duck".
  b.box(Mat.hazardBody, width, 1.5, 0.4, 0, 2.0);
  b.box(Mat.hazardStripe, width - 0.04, 0.08, 0.44, 0, 1.32);
  b.box(Mat.hazardWarn, width - 0.3, 0.04, 0.36, 0, 1.26);
  for (const s of [-1, 1]) {
    b.box(Mat.archFrame, 0.1, 2.9, 0.1, s * (width / 2 + 0.12), 1.45);
  }
  const arrows = width > 3 ? [-1.1, 1.1] : [0];
  for (const x of arrows) chevron(b, 'down', 0.46, x, 1.72, 0.23);
  return b.build(`beam:${width}`);
}

function buildPylon(): THREE.Object3D {
  const b = new PartBuilder();
  b.box(Mat.hazardBody, 1.45, 2.5, 0.7, 0, 1.25);
  b.box(Mat.hazardStripe, 1.5, 0.09, 0.74, 0, 2.0);
  b.box(Mat.hazardStripe, 1.5, 0.09, 0.74, 0, 0.5);
  b.box(Mat.hazardStripe, 0.34, 1.1, 0.76, 0, 1.25);
  // Opposed chevrons: no way through, go around either side.
  chevron(b, 'left', 0.44, -0.44, 1.25, 0.38);
  chevron(b, 'right', 0.44, 0.44, 1.25, 0.38);
  return b.build('pylon');
}

function buildCrate(): THREE.Object3D {
  const b = new PartBuilder();
  // Stacked freight containers — same language, different silhouette.
  b.box(Mat.hazardBody, 1.5, 1.05, 1.1, 0, 0.53);
  b.box(Mat.hazardBody, 1.24, 0.9, 0.94, 0, 1.5);
  b.box(Mat.hazardStripe, 1.54, 0.055, 1.14, 0, 1.02);
  b.box(Mat.hazardStripe, 1.28, 0.055, 0.98, 0, 1.93);
  chevron(b, 'left', 0.42, -0.44, 1.4, 0.58);
  chevron(b, 'right', 0.42, 0.44, 1.4, 0.58);
  return b.build('crate');
}

function buildBarrier2(): THREE.Object3D {
  const b = new PartBuilder();
  const w = LANE_WIDTH + 1.5;
  b.box(Mat.hazardBody, w, 2.4, 0.55, 0, 1.2);
  b.box(Mat.hazardStripe, w + 0.04, 0.1, 0.6, 0, 1.9);
  b.box(Mat.hazardStripe, w + 0.04, 0.1, 0.6, 0, 0.55);
  // Chevrons point off the wall's open edge — follow them and you are
  // heading for the lane that is actually free.
  for (let i = 0; i < 3; i++) {
    chevron(b, 'right', 0.5, -1.1 + i * 1.1, 1.25, 0.3);
  }
  return b.build('barrier2');
}

function buildFreight(): THREE.Object3D {
  const b = new PartBuilder();
  const len = 13;
  b.box(Mat.hazardBody, 1.85, 2.25, len, 0, 1.35);
  b.box(Mat.hazardStripe, 1.6, 0.22, len - 0.6, 0, 0.24);
  // Window band and a lit nose give the hover-freight a direction.
  for (let i = 0; i < 5; i++) {
    b.box(Mat.window, 1.9, 0.34, 1.5, 0, 1.75, -len / 2 + 1.6 + i * 2.5);
  }
  b.box(Mat.hazardStripe, 1.7, 0.5, 0.12, 0, 1.4, len / 2 + 0.02);
  return b.build('freight');
}

function buildDrone(): THREE.Object3D {
  const b = new PartBuilder();
  const hull = new THREE.IcosahedronGeometry(0.62, 0);
  hull.scale(1.5, 0.85, 1.1);
  b.add(hull, Mat.hazardBody, 0, 1.35);
  b.add(new THREE.TorusGeometry(0.85, 0.055, 6, 18), Mat.hazardStripe, 0, 1.35, 0, { x: Math.PI / 2 });
  b.box(Mat.hazardStripe, 0.5, 0.11, 0.1, 0, 1.4, 0.62);
  // Tether beam to the deck: makes the full-height block unmistakable.
  b.box(Mat.powerShell, 0.5, 1.35, 0.5, 0, 0.68);
  return b.build('drone');
}

function buildSweeper(): THREE.Object3D {
  const group = new THREE.Group();

  // The gantry rail is fixed to the track; only the arm travels along
  // it. Keeping them in separate nodes means the sweep animation reads
  // as a machine on a rail rather than a rail sliding sideways.
  const rail = new PartBuilder();
  rail.box(Mat.archFrame, TRACK_SPAN, 0.14, 0.2, 0, 3.0);
  for (const s of [-1, 1]) {
    rail.box(Mat.archFrame, 0.18, 3.1, 0.22, s * (TRACK_SPAN / 2 - 0.1), 1.55);
  }
  group.add(rail.build('sweeper.rail'));

  const arm = new PartBuilder();
  arm.box(Mat.hazardBody, 2.4, 0.42, 0.44, 0, 1.85);
  arm.box(Mat.hazardStripe, 2.44, 0.1, 0.48, 0, 1.63);
  arm.box(Mat.hazardBody, 0.5, 1.1, 0.5, 0, 2.4);
  chevron(arm, 'down', 0.5, 0, 1.9, 0.24);
  const armGroup = arm.build('sweeper.arm');
  armGroup.name = 'arm';
  group.add(armGroup);

  return group;
}

/**
 * World X of an obstacle's centre. Multi-lane hazards straddle the
 * lanes they occupy, so this is the midpoint of the outermost two.
 * Shared by the renderer and the headless simulation so they can never
 * disagree about where a hazard actually is.
 */
export function obstacleCentreX(def: ObstacleDef, anchor: number): number {
  let min = def.lanes[0];
  let max = def.lanes[0];
  for (const o of def.lanes) {
    if (o < min) min = o;
    if (o > max) max = o;
  }
  const clamp = (l: number): number => (l < 0 ? 0 : l > LANE_COUNT - 1 ? LANE_COUNT - 1 : l);
  return (LANE_X[clamp(anchor + min)] + LANE_X[clamp(anchor + max)]) / 2;
}

/** The complete obstacle catalogue. */
export const OBSTACLES: Record<ObstacleType, ObstacleDef> = {
  hurdle: {
    type: 'hurdle', block: Block.Low, lanes: [0],
    width: 1.7, depth: 0.5, minY: 0, maxY: 0.9,
    build: () => buildHurdle(1.7),
  },
  hurdleWide: {
    type: 'hurdleWide', block: Block.Low, lanes: [0, 1],
    width: LANE_WIDTH + 1.7, depth: 0.5, minY: 0, maxY: 0.9,
    build: () => buildHurdle(LANE_WIDTH + 1.7),
  },
  beam: {
    type: 'beam', block: Block.High, lanes: [0],
    width: 1.9, depth: 0.44, minY: 1.24, maxY: 2.75,
    build: () => buildBeam(1.9),
  },
  beamWide: {
    type: 'beamWide', block: Block.High, lanes: [0, 1],
    width: LANE_WIDTH + 1.9, depth: 0.44, minY: 1.24, maxY: 2.75,
    build: () => buildBeam(LANE_WIDTH + 1.9),
  },
  pylon: {
    type: 'pylon', block: Block.Full, lanes: [0],
    width: 1.45, depth: 0.7, minY: 0, maxY: 2.5,
    build: buildPylon,
  },
  crate: {
    type: 'crate', block: Block.Full, lanes: [0],
    width: 1.5, depth: 1.1, minY: 0, maxY: 1.95,
    build: buildCrate,
  },
  barrier2: {
    type: 'barrier2', block: Block.Full, lanes: [0, 1],
    width: LANE_WIDTH + 1.5, depth: 0.55, minY: 0, maxY: 2.4,
    build: buildBarrier2,
  },
  freight: {
    type: 'freight', block: Block.Full, lanes: [0],
    width: 1.85, depth: 13, minY: 0, maxY: 2.5,
    build: buildFreight,
  },
  drone: {
    type: 'drone', block: Block.Full, lanes: [0, 1], motion: 'patrol',
    width: 1.7, depth: 1.3, minY: 0, maxY: 2.1,
    build: buildDrone,
  },
  sweeper: {
    type: 'sweeper', block: Block.High, lanes: [-1, 0, 1], motion: 'sweep',
    width: 2.4, depth: 0.5, minY: 1.24, maxY: 3.2,
    build: buildSweeper,
  },
};
