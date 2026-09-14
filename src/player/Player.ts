import * as THREE from 'three';
import { PlayerModel } from './PlayerModel';
import { RunnerRig } from './RunnerRig';
import { MovementEvents, PlayerMovement } from './PlayerMovement';
import { InputManager } from '../input/InputManager';
import {
  PLAYER_HALF_WIDTH,
  PLAYER_SLIDE_HEIGHT,
  PLAYER_STAND_HEIGHT,
} from '../core/Config';
import { Mat } from '../render/Materials';
import { Geo } from '../render/Geometries';
import { damp } from '../core/MathUtils';
import { PlayerBounds } from '../systems/CollisionSystem';

export type { PlayerBounds };

/**
 * Facade tying the kinematic state machine to its visual rig, plus the
 * collider the collision system reads. The player never translates in
 * Z — the world scrolls past a stationary runner.
 */
export class Player {
  readonly object = new THREE.Group();
  readonly movement: PlayerMovement;
  private model: RunnerRig = new PlayerModel();
  private readonly bounds: PlayerBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  private readonly shieldBubble: THREE.Group;
  private shielded = false;
  private hitFlash = 0;

  constructor(events: MovementEvents = {}) {
    this.movement = new PlayerMovement(events);
    this.object.add(this.model.root);

    this.shieldBubble = new THREE.Group();
    this.shieldBubble.add(new THREE.Mesh(Geo.icosahedron(0.82, 1), Mat.shieldBubble));
    this.shieldBubble.add(new THREE.Mesh(Geo.icosahedron(0.84, 1), Mat.shieldWire));
    this.shieldBubble.position.y = PLAYER_STAND_HEIGHT * 0.55;
    this.shieldBubble.visible = false;
    this.object.add(this.shieldBubble);
  }

  /** Swap the visual rig (e.g. once the skinned model has loaded). */
  setRig(rig: RunnerRig): void {
    this.object.remove(this.model.root);
    this.model = rig;
    this.model.reset();
    this.object.add(this.model.root);
  }

  get x(): number { return this.movement.x; }
  get y(): number { return this.movement.y; }

  update(dt: number, input: InputManager, speed: number, controllable: boolean): void {
    this.movement.update(dt, input, controllable);

    this.object.position.x = this.movement.x;
    this.object.position.y = this.movement.y;

    this.model.update(
      dt,
      speed,
      this.movement.lateralVelocity,
      this.movement.airBlend,
      this.movement.slideBlend,
      this.movement.y,
      0,
    );

    // Collider follows the visual posture: sliding genuinely lowers the
    // hit box, so what you see is what collides.
    const height = PLAYER_STAND_HEIGHT
      + (PLAYER_SLIDE_HEIGHT - PLAYER_STAND_HEIGHT) * this.movement.slideBlend;
    this.bounds.minX = this.movement.x - PLAYER_HALF_WIDTH;
    this.bounds.maxX = this.movement.x + PLAYER_HALF_WIDTH;
    this.bounds.minY = this.movement.y + 0.05;
    this.bounds.maxY = this.movement.y + height;

    if (this.shielded) {
      this.shieldBubble.rotation.y += dt * 0.8;
      this.shieldBubble.rotation.x += dt * 0.35;
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.035;
      this.shieldBubble.scale.setScalar(pulse);
      // Follow the runner into a slide so the shell never clips the deck.
      this.shieldBubble.position.y = PLAYER_STAND_HEIGHT * 0.55 - this.movement.slideBlend * 0.22;
    }

    if (this.hitFlash > 0) {
      this.hitFlash = damp(this.hitFlash, 0, 8, dt);
      this.model.root.visible = Math.sin(performance.now() * 0.045) > -0.3;
      if (this.hitFlash < 0.02) {
        this.hitFlash = 0;
        this.model.root.visible = true;
      }
    }
  }

  getBounds(): PlayerBounds {
    return this.bounds;
  }

  setShield(active: boolean): void {
    this.shielded = active;
    this.shieldBubble.visible = active;
  }

  /** Visual-only feedback for a hit that was absorbed. */
  flinch(): void {
    this.hitFlash = 1;
  }

  crash(): void {
    this.model.setStunned();
  }

  reset(): void {
    this.movement.reset();
    this.model.reset();
    this.model.root.visible = true;
    this.hitFlash = 0;
    this.setShield(false);
    this.object.position.set(0, 0, 0);
  }
}
