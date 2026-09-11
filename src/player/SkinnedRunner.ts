import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Geo } from '../render/Geometries';
import { Palette } from '../render/Palette';
import { clamp, damp } from '../core/MathUtils';
import { GRAVITY, JUMP_VELOCITY, PLAYER_STAND_HEIGHT } from '../core/Config';
import { RunnerRig, contactShadowTexture } from './RunnerRig';

type ClipName = 'run' | 'jump' | 'death' | 'idle';

const AIR_TIME = (2 * JUMP_VELOCITY) / GRAVITY;

/**
 * A skinned, keyframe-animated runner driven by an AnimationMixer, in the
 * style of three.js' skinning/blending example: locomotion clips are
 * cross-faded rather than switched, and the run cycle's time scale
 * follows the player's speed so stride length stays believable.
 *
 * Posture that the source model has no clip for — the slide, the lean
 * into speed, the bank into a lane change — is layered on top of the
 * mixer output procedurally, after `mixer.update()` and before render.
 */
export class SkinnedRunner implements RunnerRig {
  readonly root = new THREE.Group();

  /** Turns the model to face −Z (travel direction) and applies scale. */
  private readonly facing = new THREE.Group();
  /** Lean / bank / squash live here so the mixer never fights them. */
  private readonly body = new THREE.Group();

  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<ClipName, THREE.AnimationAction>;
  private current: ClipName = 'run';

  private readonly hips: THREE.Object3D | null;
  private readonly spine: THREE.Object3D[];
  private readonly hipsRestY: number;

  private readonly contactShadow: THREE.Mesh;
  private readonly trail: THREE.Mesh[] = [];

  private crouch = 0;
  private lean = 0;
  private roll = 0;
  private wasAirborne = false;
  private stunned = false;

  static async load(url: string): Promise<SkinnedRunner> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new SkinnedRunner(gltf.scene, gltf.animations);
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[]) {
    // ── Scale to the collider height and face the travel direction ──
    const bounds = new THREE.Box3().setFromObject(scene);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = PLAYER_STAND_HEIGHT / size.y;
    this.facing.scale.setScalar(scale);
    this.facing.rotation.y = Math.PI;
    this.facing.position.y = -bounds.min.y * scale;

    this.root.add(this.body);
    this.body.add(this.facing);
    this.facing.add(scene);

    // ── Re-skin to the game's palette ───────────────────────────────
    // The asset ships in orange/grey/black; the same three slots become
    // pale body, dark joints and cyan trim so the runner reads as the
    // same character the rest of the world was designed around.
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false; // skinned bounds lag the pose
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || mat.type !== 'MeshStandardMaterial') return;
      const name = mat.name;
      const next = mat.clone();
      next.flatShading = true;
      next.metalness = 0.1;
      if (name === 'Main') {
        next.color.set(Palette.player);
        next.roughness = 0.4;
      } else if (name === 'Grey') {
        next.color.set(Palette.playerDark);
        next.roughness = 0.5;
        next.metalness = 0.35;
      } else {
        next.color.set(0x061018);
        next.emissive.set(Palette.playerTrim);
        next.emissiveIntensity = 1.6;
        next.roughness = 0.3;
      }
      next.needsUpdate = true;
      mesh.material = next;
    });

    // ── Bones used for procedural posture ───────────────────────────
    this.hips = scene.getObjectByName('Hips') ?? null;
    this.spine = ['Abdomen', 'Torso', 'Neck']
      .map((n) => scene.getObjectByName(n))
      .filter((b): b is THREE.Object3D => !!b);
    this.hipsRestY = this.hips?.position.y ?? 0;

    // ── Animation ───────────────────────────────────────────────────
    this.mixer = new THREE.AnimationMixer(scene);
    const clip = (name: string): THREE.AnimationClip => {
      const found = THREE.AnimationClip.findByName(clips, name);
      if (!found) throw new Error(`Runner model is missing the "${name}" clip`);
      return found;
    };
    this.actions = {
      run: this.mixer.clipAction(clip('Running')),
      jump: this.mixer.clipAction(clip('Jump')),
      death: this.mixer.clipAction(clip('Death')),
      idle: this.mixer.clipAction(clip('Idle')),
    };
    for (const a of [this.actions.jump, this.actions.death]) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    // Fit the jump clip to the physics arc so the tuck and the landing
    // happen where the body actually is.
    this.actions.jump.timeScale = this.actions.jump.getClip().duration / (AIR_TIME * 1.05);
    this.actions.run.play();

    // ── Contact shadow + speed trail (shared language with the fallback rig) ──
    this.contactShadow = new THREE.Mesh(
      Geo.plane(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(), transparent: true, opacity: 0.5, depthWrite: false, color: 0x000000,
      }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.02;
    this.contactShadow.renderOrder = -1;
    this.root.add(this.contactShadow);

    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(
        Geo.box(0.06, 0.06, 1),
        new THREE.MeshBasicMaterial({
          color: Palette.cyan, transparent: true, opacity: 0.32 - i * 0.08, depthWrite: false, toneMapped: false,
        }),
      );
      t.position.set((i - 1) * 0.28, 0.9 + (i === 1 ? 0.25 : 0), 0.55);
      this.trail.push(t);
      this.body.add(t);
    }
  }

  private play(name: ClipName, fade: number): void {
    if (this.current === name) return;
    const from = this.actions[this.current];
    const to = this.actions[name];
    to.reset().setEffectiveWeight(1).play();
    from.crossFadeTo(to, fade, false);
    this.current = name;
  }

  update(
    dt: number,
    speed: number,
    lateralVelocity: number,
    airborne: number,
    sliding: number,
    height: number,
    groundY: number,
  ): void {
    if (!this.stunned) {
      // Stride follows speed but compresses at the top end so the legs
      // never become a blur.
      this.actions.run.timeScale = clamp(0.55 + speed * 0.052, 0.7, 2.1);

      const inAir = airborne > 0.5;
      if (inAir && !this.wasAirborne) this.play('jump', 0.06);
      if (!inAir && this.wasAirborne) this.play('run', 0.14);
      this.wasAirborne = inAir;
    }

    this.mixer.update(dt);

    // ── Procedural posture on top of the clip ───────────────────────
    this.crouch = damp(this.crouch, sliding, 22, dt);
    if (!this.stunned && this.crouch > 0.005) {
      // Slide: fold the spine forward and drop the hips. Applied after
      // the mixer so it stacks on the run cycle instead of replacing it.
      for (const bone of this.spine) bone.rotation.x += this.crouch * 0.42;
      if (this.hips) this.hips.position.y = this.hipsRestY * (1 - this.crouch * 0.55);
    }

    const targetLean = 0.06 + Math.min(speed, 30) * 0.006 + this.crouch * 0.55 - airborne * 0.12;
    this.lean = damp(this.lean, targetLean, 14, dt);
    const targetRoll = clamp(lateralVelocity * 0.026, -0.34, 0.34);
    this.roll = damp(this.roll, targetRoll, 15, dt);
    this.body.rotation.x = this.stunned ? this.body.rotation.x : -this.lean;
    this.body.rotation.z = this.roll;
    this.body.rotation.y = damp(this.body.rotation.y, -targetRoll * 0.8, 12, dt);
    // A touch of squash on the slide so the silhouette change is legible
    // from behind, where a forward fold alone reads as "shorter".
    this.body.scale.y = 1 - this.crouch * 0.18;
    this.body.scale.x = 1 + this.crouch * 0.06;

    // ── Contact shadow ──────────────────────────────────────────────
    const airGap = clamp(height - groundY, 0, 3.2);
    const shrink = 1 - airGap * 0.22;
    this.contactShadow.position.y = groundY - height + 0.03;
    this.contactShadow.scale.setScalar(Math.max(0.35, shrink));
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity =
      0.5 * Math.max(0.12, shrink) * (1 - this.crouch * 0.15);

    // ── Speed trail ─────────────────────────────────────────────────
    const trailLen = this.stunned ? 0 : clamp((speed - 12) * 0.16, 0, 2.6);
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const len = trailLen * (1 - i * 0.22);
      t.scale.z = Math.max(0.001, len);
      t.position.z = 0.45 + len * 0.5;
      t.visible = len > 0.05;
      t.position.y = (i === 1 ? 1.15 : 0.9) - this.crouch * 0.55;
    }
  }

  setStunned(): void {
    if (this.stunned) return;
    this.stunned = true;
    this.play('death', 0.1);
  }

  reset(): void {
    this.stunned = false;
    this.wasAirborne = false;
    this.crouch = 0;
    this.lean = 0;
    this.roll = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    this.mixer.stopAllAction();
    this.current = 'run';
    this.actions.run.reset().setEffectiveWeight(1).play();
    if (this.hips) this.hips.position.y = this.hipsRestY;
  }
}
