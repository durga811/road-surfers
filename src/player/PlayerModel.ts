import * as THREE from 'three';
import { Geo } from '../render/Geometries';
import { Mat } from '../render/Materials';
import { Palette } from '../render/Palette';
import { clamp, damp, lerp } from '../core/MathUtils';
import { PLAYER_SCALE } from '../core/Config';
import { RunnerRig, contactShadowTexture } from './RunnerRig';

/**
 * Fallback runner: a stylised courier built entirely from primitives,
 * with a hand-authored joint rig driven procedurally. Used only when the
 * skinned model cannot be fetched, so the game never depends on a
 * network request to be playable.
 */
export class PlayerModel implements RunnerRig {
  readonly root = new THREE.Group();
  /**
   * The rig is authored in its own space with +Z as "forward", which is
   * the natural way to lay out a character. Travel is along −Z, so this
   * node does the one-time turnaround; every pose below stays readable
   * in model space.
   */
  private readonly facing = new THREE.Group();
  /** Everything that leans/tilts. Kept separate from `root` so the
   *  movement code can own position while the model owns pose. */
  readonly body = new THREE.Group();

  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly forearmL = new THREE.Group();
  private readonly forearmR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();

  private readonly contactShadow: THREE.Mesh;
  private readonly trail: THREE.Mesh[] = [];

  private phase = 0;
  private lean = 0;
  private roll = 0;
  private crouch = 0;

  constructor() {
    this.facing.rotation.y = Math.PI;
    // Authored at 1.62 m; PLAYER_SCALE brings it to the collider height.
    this.facing.scale.setScalar(PLAYER_SCALE);
    this.root.add(this.facing);
    this.facing.add(this.body);
    this.body.add(this.hips);

    // ── Torso ────────────────────────────────────────────────────────
    this.hips.position.y = 0.82;
    this.hips.add(this.torso);

    const pelvis = new THREE.Mesh(Geo.box(0.44, 0.2, 0.26), Mat.playerDark);
    pelvis.position.y = 0.02;
    this.torso.add(pelvis);

    const chest = new THREE.Mesh(Geo.box(0.48, 0.46, 0.28), Mat.playerBody);
    chest.position.y = 0.33;
    this.torso.add(chest);

    // Emissive chest bar plus shoulder caps — the cyan read that
    // identifies "you" at a glance from the chase camera.
    const chestTrim = new THREE.Mesh(Geo.box(0.5, 0.07, 0.31), Mat.playerTrim);
    chestTrim.position.set(0, 0.4, 0);
    this.torso.add(chestTrim);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(Geo.box(0.1, 0.16, 0.29), Mat.playerTrim);
      cap.position.set(s * 0.25, 0.34, 0);
      this.torso.add(cap);
    }

    const backpack = new THREE.Mesh(Geo.box(0.3, 0.34, 0.16), Mat.playerDark);
    backpack.position.set(0, 0.34, -0.2);
    this.torso.add(backpack);
    const packLight = new THREE.Mesh(Geo.box(0.16, 0.045, 0.02), Mat.playerTrim);
    packLight.position.set(0, 0.44, -0.29);
    this.torso.add(packLight);

    // ── Head ─────────────────────────────────────────────────────────
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(Geo.box(0.3, 0.3, 0.3), Mat.playerBody);
    this.head.add(skull);
    const visor = new THREE.Mesh(Geo.box(0.26, 0.11, 0.06), Mat.playerDark);
    visor.position.set(0, 0.01, 0.16);
    this.head.add(visor);
    const visorGlow = new THREE.Mesh(Geo.box(0.21, 0.05, 0.02), Mat.playerTrim);
    visorGlow.position.set(0, 0.01, 0.2);
    this.head.add(visorGlow);
    // A crest along the top of the helmet keeps the silhouette legible
    // when the runner is backlit by the fog.
    const crest = new THREE.Mesh(Geo.box(0.06, 0.04, 0.28), Mat.playerTrim);
    crest.position.set(0, 0.16, 0.02);
    this.head.add(crest);

    // ── Arms ─────────────────────────────────────────────────────────
    this.buildArm(this.armL, this.forearmL, -1);
    this.buildArm(this.armR, this.forearmR, 1);

    // ── Legs ─────────────────────────────────────────────────────────
    this.buildLeg(this.legL, this.shinL, -1);
    this.buildLeg(this.legR, this.shinR, 1);

    // ── Contact shadow ───────────────────────────────────────────────
    // A soft blob that always grounds the character, even when real
    // shadows are disabled on the low-quality tier.
    this.contactShadow = new THREE.Mesh(
      Geo.plane(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        color: 0x000000,
      }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.02;
    this.contactShadow.renderOrder = -1;
    this.root.add(this.contactShadow);

    // ── Speed trail ──────────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(
        Geo.box(0.06, 0.06, 1),
        new THREE.MeshBasicMaterial({
          color: Palette.cyan,
          transparent: true,
          opacity: 0.32 - i * 0.08,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      t.position.set((i - 1) * 0.28, 0.9 + (i === 1 ? 0.25 : 0), -0.55);
      this.trail.push(t);
      this.body.add(t);
    }

    // Same rule as props: the lit body casts, the emissive trim doesn't.
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = (mesh.material as THREE.Material).type === 'MeshStandardMaterial';
    });
    this.contactShadow.castShadow = false;
  }

  private buildArm(shoulder: THREE.Group, elbow: THREE.Group, side: number): void {
    shoulder.position.set(side * 0.3, 0.52, 0);
    this.torso.add(shoulder);
    const upper = new THREE.Mesh(Geo.box(0.13, 0.3, 0.13), Mat.playerBody);
    upper.position.y = -0.15;
    shoulder.add(upper);

    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const lower = new THREE.Mesh(Geo.box(0.115, 0.28, 0.115), Mat.playerDark);
    lower.position.y = -0.14;
    elbow.add(lower);
    const cuff = new THREE.Mesh(Geo.box(0.135, 0.04, 0.135), Mat.playerTrim);
    cuff.position.y = -0.27;
    elbow.add(cuff);
  }

  private buildLeg(hip: THREE.Group, knee: THREE.Group, side: number): void {
    hip.position.set(side * 0.14, -0.02, 0);
    this.hips.add(hip);
    const thigh = new THREE.Mesh(Geo.box(0.17, 0.4, 0.17), Mat.playerBody);
    thigh.position.y = -0.2;
    hip.add(thigh);

    knee.position.y = -0.4;
    hip.add(knee);
    const shin = new THREE.Mesh(Geo.box(0.15, 0.36, 0.15), Mat.playerDark);
    shin.position.y = -0.18;
    knee.add(shin);
    const foot = new THREE.Mesh(Geo.box(0.17, 0.09, 0.28), Mat.playerBody);
    foot.position.set(0, -0.38, 0.05);
    knee.add(foot);
    const sole = new THREE.Mesh(Geo.box(0.15, 0.025, 0.24), Mat.playerTrim);
    sole.position.set(0, -0.425, 0.05);
    knee.add(sole);
  }

  /**
   * @param groundY   Deck height under the player (for the contact blob).
   * @param airborne  0 = planted, 1 = fully airborne.
   * @param sliding   0 = upright, 1 = fully in the slide pose.
   */
  update(
    dt: number,
    speed: number,
    lateralVelocity: number,
    airborne: number,
    sliding: number,
    height: number,
    groundY: number,
  ): void {
    // Stride frequency scales with speed but compresses at the top end
    // so the legs never turn into a blur.
    const stride = 1.35 + Math.min(speed, 30) * 0.24;
    this.phase += dt * stride * (1 - airborne * 0.85);

    this.crouch = damp(this.crouch, sliding, 22, dt);
    const run = (1 - airborne) * (1 - this.crouch);

    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    // ── Run cycle ───────────────────────────────────────────────────
    const swing = 0.95 * run;
    this.legL.rotation.x = s * swing - 0.08;
    this.legR.rotation.x = -s * swing - 0.08;
    this.shinL.rotation.x = Math.max(0, -s) * 1.25 * run + 0.06;
    this.shinR.rotation.x = Math.max(0, s) * 1.25 * run + 0.06;

    this.armL.rotation.x = -s * 0.85 * run;
    this.armR.rotation.x = s * 0.85 * run;
    this.armL.rotation.z = 0.16;
    this.armR.rotation.z = -0.16;
    this.forearmL.rotation.x = -(0.5 + Math.max(0, -s) * 0.5) * run;
    this.forearmR.rotation.x = -(0.5 + Math.max(0, s) * 0.5) * run;

    // ── Airborne pose: tuck knees, arms up ──────────────────────────
    if (airborne > 0.01) {
      const a = airborne;
      this.legL.rotation.x = lerp(this.legL.rotation.x, -0.75, a);
      this.legR.rotation.x = lerp(this.legR.rotation.x, -0.35, a);
      this.shinL.rotation.x = lerp(this.shinL.rotation.x, 1.5, a);
      this.shinR.rotation.x = lerp(this.shinR.rotation.x, 0.9, a);
      this.armL.rotation.x = lerp(this.armL.rotation.x, -1.6, a);
      this.armR.rotation.x = lerp(this.armR.rotation.x, -1.35, a);
      this.forearmL.rotation.x = lerp(this.forearmL.rotation.x, -0.5, a);
      this.forearmR.rotation.x = lerp(this.forearmR.rotation.x, -0.5, a);
    }

    // ── Slide pose: body flat, lead leg extended ────────────────────
    if (this.crouch > 0.01) {
      const k = this.crouch;
      this.legL.rotation.x = lerp(this.legL.rotation.x, -1.25, k);
      this.legR.rotation.x = lerp(this.legR.rotation.x, -0.35, k);
      this.shinL.rotation.x = lerp(this.shinL.rotation.x, 0.15, k);
      this.shinR.rotation.x = lerp(this.shinR.rotation.x, 1.7, k);
      this.armL.rotation.x = lerp(this.armL.rotation.x, 0.9, k);
      this.armR.rotation.x = lerp(this.armR.rotation.x, 1.7, k);
      this.forearmL.rotation.x = lerp(this.forearmL.rotation.x, -0.4, k);
      this.forearmR.rotation.x = lerp(this.forearmR.rotation.x, -0.2, k);
    }

    // ── Torso attitude ──────────────────────────────────────────────
    // Forward lean grows with speed; roll banks into lane changes.
    const targetLean = 0.11 + Math.min(speed, 30) * 0.007 + this.crouch * 1.18 - airborne * 0.16;
    this.lean = damp(this.lean, targetLean, 14, dt);
    const targetRoll = clamp(lateralVelocity * 0.026, -0.34, 0.34);
    this.roll = damp(this.roll, targetRoll, 15, dt);

    this.body.rotation.x = this.lean;
    this.body.rotation.z = this.roll;
    this.body.rotation.y = damp(this.body.rotation.y, targetRoll * 0.8, 12, dt);

    // Vertical bob on the run cycle; sinks into the slide.
    const bob = Math.abs(c) * 0.05 * run;
    this.hips.position.y = 0.82 + bob - this.crouch * 0.5;
    this.torso.rotation.x = -this.crouch * 0.32;
    this.head.rotation.x = -this.lean * 0.65 + this.crouch * 0.5;

    // ── Contact shadow ──────────────────────────────────────────────
    const airGap = clamp(height - groundY, 0, 3.2);
    const shrink = 1 - airGap * 0.22;
    this.contactShadow.position.y = groundY - height + 0.03;
    this.contactShadow.scale.setScalar(Math.max(0.35, shrink));
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity =
      0.5 * Math.max(0.12, shrink) * (1 - this.crouch * 0.15);

    // ── Speed trail ─────────────────────────────────────────────────
    const trailLen = clamp((speed - 12) * 0.16, 0, 2.6);
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const len = trailLen * (1 - i * 0.22);
      t.scale.z = Math.max(0.001, len);
      t.position.z = -0.45 - len * 0.5;
      t.visible = len > 0.05;
      t.position.y = (i === 1 ? 1.15 : 0.9) - this.crouch * 0.55;
    }
  }

  /** Flat, limp pose used for the crash animation. */
  setStunned(): void {
    this.armL.rotation.set(-2.2, 0, 0.5);
    this.armR.rotation.set(-2.0, 0, -0.5);
    this.legL.rotation.x = 0.6;
    this.legR.rotation.x = 0.3;
    for (const t of this.trail) t.visible = false;
  }

  reset(): void {
    this.phase = 0;
    this.lean = 0;
    this.roll = 0;
    this.crouch = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.scale.setScalar(1);
  }
}
