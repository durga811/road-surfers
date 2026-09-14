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
  MAX_PIXEL_RATIO_TOUCH,
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
  private readonly canvas: HTMLCanvasElement;
  private observer: ResizeObserver | null = null;
  private readonly fogOpen = new THREE.Color(Palette.fog);
  private readonly fogTunnel = new THREE.Color(0x0a0d1c);
  private readonly sky: THREE.Object3D;
  private readonly shadowTarget = new THREE.Object3D();

  quality: QualityLevel = 'high';
  /** Raised when the GPU drops the context; the game pauses until restore. */
  onContextLost?: () => void;
  onContextRestored?: () => void;
  private readonly touch: boolean;
  private usePost = true;
  private degradeTimer = 0;
  private locked = false;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(canvas: HTMLCanvasElement, touch = false) {
    this.canvas = canvas;
    this.touch = touch;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.targetPixelRatio());
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

    // A lost context is routine on mobile (backgrounding, GPU pressure).
    // Left unhandled it is a permanently frozen black canvas; preventing
    // the default lets the browser hand the context back, and three
    // re-uploads the geometry and textures it already holds in memory.
    canvas.addEventListener('webglcontextlost', this.onContextLostEvent, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestoredEvent, false);

    // Both signals, deliberately.
    //
    // A ResizeObserver reports the container's box *after* layout, which
    // is what we actually draw into — `resize` can fire before the new
    // dimensions are readable, and fullscreen transitions and mobile
    // toolbar collapses may not fire it at a useful moment at all.
    //
    // But ResizeObserver callbacks are delivered as part of the
    // rendering steps, so they are suspended while the document is
    // hidden or rendering is throttled. The window events are not, and
    // keep working in those cases.
    //
    // Both funnel into the same handler, which no-ops when nothing has
    // actually changed, so the overlap is free.
    const container = canvas.parentElement;
    if (container && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onResize);
      this.observer.observe(container);
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('fullscreenchange', this.onResize);
  }

  private targetPixelRatio(): number {
    const cap = this.touch ? MAX_PIXEL_RATIO_TOUCH : MAX_PIXEL_RATIO;
    return Math.min(window.devicePixelRatio, cap);
  }

  private readonly onContextLostEvent = (event: Event): void => {
    event.preventDefault();
    this.onContextLost?.();
  };

  private readonly onContextRestoredEvent = (): void => {
    this.setQuality(this.quality);
    this.onContextRestored?.();
  };

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
        this.renderer.setPixelRatio(this.targetPixelRatio());
        break;
      case 'medium':
        this.usePost = true;
        this.bloom.strength = 0.45;
        this.renderer.shadowMap.enabled = true;
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(1024, 1024);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
        this.renderer.setPixelRatio(Math.min(this.targetPixelRatio(), 1.25));
        break;
      case 'low':
        this.usePost = false;
        this.renderer.shadowMap.enabled = false;
        this.keyLight.castShadow = false;
        this.renderer.setPixelRatio(1);
        break;
    }
    this.lastWidth = 0; // force the next resize through
    this.onResize();
  }

  /** Prevents the auto-degrade from firing (used by the ?quality= flag). */
  lockQuality(): void {
    this.locked = true;
  }

  private readonly onResize = (): void => {
    // A hidden or collapsed container reports zero, which produces an
    // incomplete framebuffer and a flood of GL warnings.
    const box = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(1, Math.round(box?.width || window.innerWidth));
    const h = Math.max(1, Math.round(box?.height || window.innerHeight));
    if (w === this.lastWidth && h === this.lastHeight) return;
    this.lastWidth = w;
    this.lastHeight = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * 0.5, h * 0.5);
  };

  dispose(): void {
    this.observer?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('fullscreenchange', this.onResize);
    this.composer.dispose();
    this.renderer.dispose();
  }
}
