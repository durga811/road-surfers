import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Palette } from './Palette';
import { createSky, updateSky } from './Sky';
import {
  CAMERA_FOV_BASE,
  FOG_FAR,
  FOG_NEAR,
  MAX_PIXEL_RATIO,
} from '../core/Config';
import { lerp } from '../core/MathUtils';

export type QualityLevel = 'high' | 'medium' | 'low';

/**
 * Owns the renderer, scene graph root, lighting rig and post stack,
 * plus the adaptive-quality controller that degrades gracefully when
 * a machine can't hold frame rate.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;

  readonly keyLight: THREE.DirectionalLight;
  private readonly bloom: UnrealBloomPass;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fogOpen = new THREE.Color(Palette.fog);
  private readonly fogTunnel = new THREE.Color(0x0a0d1c);
  private readonly sky: THREE.Object3D;
  private readonly shadowTarget = new THREE.Object3D();

  quality: QualityLevel = 'high';
  private usePost = true;
  private degradeTimer = 0;
  private locked = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(Palette.fog, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_BASE,
      window.innerWidth / window.innerHeight,
      0.1,
      700,
    );
    this.camera.position.set(0, 3.4, 7.4);

    this.sky = createSky();
    this.scene.add(this.sky);

    // ── Lighting rig ────────────────────────────────────────────────
    // Three lights total: a soft sky bounce, one shadow-casting key,
    // and a cool rim from behind that separates the player from fog.
    this.hemi = new THREE.HemisphereLight(0x4a5fb8, 0x070a18, 1.45);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xe4eeff, 2.5);
    this.keyLight.position.set(-9, 16, 10);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 60;
    this.keyLight.shadow.camera.left = -12;
    this.keyLight.shadow.camera.right = 12;
    this.keyLight.shadow.camera.top = 14;
    this.keyLight.shadow.camera.bottom = -22;
    this.keyLight.shadow.bias = -0.0016;
    this.keyLight.shadow.normalBias = 0.03;
    this.scene.add(this.keyLight);
    this.scene.add(this.shadowTarget);
    this.keyLight.target = this.shadowTarget;

    const rim = new THREE.DirectionalLight(0x4de3ff, 1.15);
    rim.position.set(6, 5, -14);
    this.scene.add(rim);

    // ── Post stack ──────────────────────────────────────────────────
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
      0.62, // strength — restrained; the neon does the work, not the glow
      0.7,  // radius
      0.68, // threshold: only emissive trim blooms, never the deck
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', this.onResize);
  }

  /**
   * Blends the atmosphere toward "inside a tunnel": closer fog and less
   * sky bounce. Driven by the environment rather than a timer, so the
   * change always lines up with what the player can see.
   */
  setEnclosure(t: number): void {
    const fog = this.scene.fog as THREE.Fog;
    fog.near = lerp(FOG_NEAR, 22, t);
    fog.far = lerp(FOG_FAR, 120, t);
    fog.color.copy(this.fogOpen).lerp(this.fogTunnel, t);
    this.hemi.intensity = lerp(1.45, 0.72, t);
    this.keyLight.intensity = lerp(2.5, 1.5, t);
  }

  /** Keeps the shadow frustum centred just ahead of the player. */
  followShadows(playerX: number): void {
    this.shadowTarget.position.set(playerX * 0.5, 0, -6);
    this.keyLight.position.set(playerX * 0.5 - 9, 16, 4);
  }

  update(time: number): void {
    updateSky(this.sky, time);
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
  }

  render(): void {
    if (this.usePost) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Drops a quality tier if the frame rate stays low for ~2.5 s.
   * One-way: we never oscillate between tiers mid-run.
   */
  monitorPerformance(fps: number, dt: number): void {
    if (this.locked || this.quality === 'low') return;
    if (fps < 46) {
      this.degradeTimer += dt;
      if (this.degradeTimer > 2.5) {
        this.setQuality(this.quality === 'high' ? 'medium' : 'low');
        this.degradeTimer = 0;
      }
    } else {
      this.degradeTimer = Math.max(0, this.degradeTimer - dt * 0.5);
    }
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    switch (level) {
      case 'high':
        this.usePost = true;
        this.bloom.strength = 0.62;
        this.renderer.shadowMap.enabled = true;
        this.keyLight.castShadow = true;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
        break;
      case 'medium':
        this.usePost = true;
        this.bloom.strength = 0.45;
        this.renderer.shadowMap.enabled = true;
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(1024, 1024);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        break;
      case 'low':
        this.usePost = false;
        this.renderer.shadowMap.enabled = false;
        this.keyLight.castShadow = false;
        this.renderer.setPixelRatio(1);
        break;
    }
    this.onResize();
  }

  /** Prevents the auto-degrade from firing (used by the ?quality= flag). */
  lockQuality(): void {
    this.locked = true;
  }

  private readonly onResize = (): void => {
    // A hidden or collapsed container reports zero, which produces an
    // incomplete framebuffer and a flood of GL warnings.
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * 0.5, h * 0.5);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
