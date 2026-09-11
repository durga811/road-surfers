import * as THREE from 'three';

/**
 * What the Player needs from whatever is drawing the character. Two
 * implementations exist: the skinned GLB runner used in normal play, and
 * the procedural primitive rig kept as a fallback for when the model
 * cannot be fetched — the game must never be unplayable because a
 * network request failed.
 */
export interface RunnerRig {
  readonly root: THREE.Object3D;

  /**
   * @param airborne  0 = planted, 1 = fully airborne.
   * @param sliding   0 = upright, 1 = fully in the slide pose.
   * @param height    Player's current Y.
   * @param groundY   Deck height under the player.
   */
  update(
    dt: number,
    speed: number,
    lateralVelocity: number,
    airborne: number,
    sliding: number,
    height: number,
    groundY: number,
  ): void;

  /** Crash reaction; the rig stays in this state until reset(). */
  setStunned(): void;

  reset(): void;
}

/** Radial-gradient sprite used for the grounding blob under the runner. */
let blobTexture: THREE.Texture | null = null;
export function contactShadowTexture(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  blobTexture = new THREE.CanvasTexture(canvas);
  blobTexture.colorSpace = THREE.SRGBColorSpace;
  return blobTexture;
}
