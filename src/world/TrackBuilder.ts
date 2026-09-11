import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mat } from '../render/Materials';
import { LANE_WIDTH, SEGMENT_LENGTH, TRACK_WIDTH } from '../core/Config';

/**
 * Builds one reusable deck segment.
 *
 * All static parts are merged into three buffers (deck / structure /
 * emissive) so a segment is three draw calls regardless of how much
 * detail it carries. The geometry is built once and shared by every
 * pooled segment instance.
 */

let cached: { deck: THREE.BufferGeometry; frame: THREE.BufferGeometry; glow: THREE.BufferGeometry } | null = null;

function buildGeometries() {
  const L = SEGMENT_LENGTH;
  const halfW = TRACK_WIDTH / 2;

  const deckParts: THREE.BufferGeometry[] = [];
  const framePartsn: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];

  const push = (
    list: THREE.BufferGeometry[],
    w: number, h: number, d: number,
    x: number, y: number, z: number,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    list.push(g);
  };

  // Deck slab — top face sits exactly at y = 0.
  push(deckParts, TRACK_WIDTH, 0.6, L, 0, -0.3, 0);

  // Transverse ribs: the primary speed cue. Spaced 3 m so they strobe
  // past at a readable rate rather than blurring.
  for (let i = 0; i < L / 3; i++) {
    const z = -L / 2 + 1.5 + i * 3;
    push(framePartsn, TRACK_WIDTH - 0.3, 0.035, 0.34, 0, 0.005, z);
  }

  // Lane seams — the two glowing dividers that make lanes readable.
  for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
    push(glowParts, 0.055, 0.02, L - 0.1, x, 0.012, 0);
  }
  // Outer edge lines
  for (const x of [-halfW + 0.55, halfW - 0.55]) {
    push(glowParts, 0.1, 0.02, L - 0.1, x, 0.012, 0);
  }

  // Side rails + kerbs
  for (const s of [-1, 1]) {
    push(framePartsn, 0.36, 0.42, L, s * (halfW - 0.18), 0.2, 0);
    push(glowParts, 0.1, 0.05, L - 0.2, s * (halfW - 0.18), 0.43, 0);
    // Rail posts
    for (let i = 0; i < L / 6; i++) {
      const z = -L / 2 + 3 + i * 6;
      push(framePartsn, 0.16, 1.15, 0.16, s * (halfW - 0.18), 0.9, z);
      push(glowParts, 0.2, 0.08, 0.2, s * (halfW - 0.18), 1.42, z);
    }
  }

  // Understructure: keeps the deck from reading as a floating plane.
  for (let i = 0; i < L / 12; i++) {
    const z = -L / 2 + 6 + i * 12;
    push(deckParts, TRACK_WIDTH - 1.2, 0.5, 1.0, 0, -0.85, z);
    for (const s of [-1, 1]) {
      push(deckParts, 0.55, 7, 0.9, s * (halfW - 1.4), -4.4, z);
    }
  }

  cached = {
    deck: mergeGeometries(deckParts, false)!,
    frame: mergeGeometries(framePartsn, false)!,
    glow: mergeGeometries(glowParts, false)!,
  };
  for (const g of [...deckParts, ...framePartsn, ...glowParts]) g.dispose();
  return cached;
}

export function createTrackSegment(): THREE.Object3D {
  const geo = cached ?? buildGeometries();
  const group = new THREE.Group();

  const deck = new THREE.Mesh(geo.deck, Mat.deck);
  deck.receiveShadow = true;
  group.add(deck);

  const frame = new THREE.Mesh(geo.frame, Mat.rail);
  frame.receiveShadow = true;
  group.add(frame);

  group.add(new THREE.Mesh(geo.glow, Mat.seam));
  return group;
}
