import * as THREE from 'three';
import {
  CAMERA_FOV_BASE,
  CAMERA_FOV_MAX,
  CAMERA_LOOK_AHEAD,
  CAMERA_OFFSET,
} from '../core/Config';
import { clamp, damp, lerp } from '../core/MathUtils';

/**
 * Chase camera.
 *
 * Three rules keep it readable: it lags the player laterally (so lane
 * changes have weight), it never lets the runner leave the lower third
 * of frame, and FOV widens with speed — the widening is what actually
 * sells acceleration, far more than moving the camera would.
 */
export class CameraController {
  private readonly target = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();

  private currentX = 0;
  private currentY = CAMERA_OFFSET.y;
  private shake = 0;
  private shakeSeed = Math.random() * 100;
  private fov = CAMERA_FOV_BASE;
  private intro = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  reset(withIntro: boolean): void {
    this.currentX = 0;
    this.currentY = CAMERA_OFFSET.y;
    this.shake = 0;
    this.fov = CAMERA_FOV_BASE;
    this.intro = withIntro ? 1 : 0;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Menu framing: a slow orbit that shows off the runner and the city. */
  updateMenu(dt: number, time: number): void {
    const radius = 4.6;
    const angle = time * 0.16;
    this.camera.position.set(
      Math.sin(angle) * radius,
      2.5 + Math.sin(time * 0.4) * 0.28,
      Math.cos(angle) * radius + 1.2,
    );
    this.lookTarget.set(0, 0.75, 0);
    this.camera.lookAt(this.lookTarget);
    this.camera.fov = damp(this.camera.fov, 52, 3, dt);
    this.camera.updateProjectionMatrix();
  }

  update(
    dt: number,
    playerX: number,
    playerY: number,
    intensity: number,
    lateralVelocity: number,
    airborne: boolean,
  ): void {
    // Lateral lag: the camera trails a lane change and settles into it.
    this.currentX = damp(this.currentX, playerX * 0.72, 9, dt);
    const heightTarget = CAMERA_OFFSET.y + playerY * 0.42 + intensity * 0.22;
    this.currentY = damp(this.currentY, heightTarget, airborne ? 7 : 11, dt);

    // Pull back slightly at speed to keep the reaction window constant.
    const distance = CAMERA_OFFSET.z + intensity * 0.85;

    if (this.intro > 0) {
      this.intro = Math.max(0, this.intro - dt * 0.85);
    }
    const introEase = this.intro * this.intro;

    this.target.set(
      this.currentX + lateralVelocity * 0.012,
      this.currentY + introEase * 5.5,
      distance + introEase * 9,
    );

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      const s = this.shake * this.shake * 0.5;
      const t = performance.now() * 0.05 + this.shakeSeed;
      this.shakeOffset.set(Math.sin(t * 1.7) * s, Math.cos(t * 2.3) * s * 0.7, 0);
      this.target.add(this.shakeOffset);
    }

    this.camera.position.copy(this.target);

    this.lookTarget.set(
      lerp(this.currentX, playerX, 0.55) * 0.8,
      1.05 + playerY * 0.5,
      -CAMERA_LOOK_AHEAD - intensity * 2.4,
    );
    this.camera.lookAt(this.lookTarget);

    // Subtle roll into lane changes — under two degrees, felt not seen.
    this.camera.rotation.z = damp(
      this.camera.rotation.z,
      clamp(-lateralVelocity * 0.0035, -0.03, 0.03),
      8,
      dt,
    );

    const fovTarget = CAMERA_FOV_BASE + (CAMERA_FOV_MAX - CAMERA_FOV_BASE) * intensity;
    this.fov = damp(this.fov, fovTarget + introEase * 6, 2.4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Death framing: drift back and up so the crash reads clearly. */
  updateCrash(dt: number, playerX: number): void {
    this.currentX = damp(this.currentX, playerX * 0.6, 4, dt);
    this.currentY = damp(this.currentY, 3.9, 2.2, dt);
    this.target.set(this.currentX, this.currentY, damp(this.camera.position.z, 9.2, 2.2, dt));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      const s = this.shake * this.shake * 0.55;
      const t = performance.now() * 0.05;
      this.target.x += Math.sin(t * 1.9) * s;
      this.target.y += Math.cos(t * 2.4) * s * 0.8;
    }

    this.camera.position.copy(this.target);
    this.lookTarget.set(playerX * 0.7, 1.0, -3);
    this.camera.lookAt(this.lookTarget);
    this.camera.rotation.z = damp(this.camera.rotation.z, 0, 3, dt);
    this.camera.fov = damp(this.camera.fov, 58, 2, dt);
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
    this.shakeSeed = Math.random() * 100;
  }
}
