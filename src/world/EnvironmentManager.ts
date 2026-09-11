import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ObjectPool } from '../core/ObjectPool';
import { createTrackSegment } from './TrackBuilder';
import { Geo } from '../render/Geometries';
import { PartBuilder } from '../render/PartBuilder';
import { Mat } from '../render/Materials';
import { Palette } from '../render/Palette';
import { Random } from '../core/Random';
import { DESPAWN_BEHIND, SEGMENT_LENGTH, TRACK_WIDTH, VIEW_DISTANCE } from '../core/Config';

const BUILDING_SLOTS = 26;
const TOWER_SLOTS = 18;

/** Spacing of the ribs that make up a tunnel section. */
const RIB_SPACING = 9;

interface Slot {
  z: number;
  x: number;
  width: number;
  depth: number;
  height: number;
  windows: number;
}

/**
 * Everything that isn't a hazard or a coin: the deck itself, the
 * skyline, the arch gates that punctuate the run, and the drifting
 * motes that give the void some volume.
 *
 * The skyline is two InstancedMeshes (bodies + window bands) so the
 * entire city costs four draw calls no matter how dense it looks.
 */
export class EnvironmentManager {
  readonly group = new THREE.Group();

  private readonly segmentPool: ObjectPool<THREE.Object3D>;
  private readonly segments: { object: THREE.Object3D; z: number }[] = [];
  private nextSegmentZ = 0;

  private readonly archPool: ObjectPool<THREE.Object3D>;
  private readonly arches: { object: THREE.Object3D; z: number }[] = [];
  private nextArchZ = -80;

  private readonly buildings: THREE.InstancedMesh;
  private readonly windows: THREE.InstancedMesh;
  private readonly towers: THREE.InstancedMesh;
  private readonly buildingSlots: Slot[] = [];
  private readonly towerSlots: Slot[] = [];

  private readonly ribPool: ObjectPool<THREE.Object3D>;
  private readonly ribs: { object: THREE.Object3D; z: number }[] = [];
  /** Tunnel sections currently in the world, in player-relative Z. */
  private readonly tunnels: { start: number; end: number }[] = [];
  private nextFeatureZ = -260;
  private nextRibZ = 0;
  private buildingTunnel: { start: number; end: number } | null = null;

  private readonly motes: THREE.Points;
  private readonly moteMaterial: THREE.ShaderMaterial;

  private readonly dummy = new THREE.Object3D();
  private readonly rng = new Random(0x5eed);

  constructor() {
    this.group.name = 'environment';

    this.segmentPool = new ObjectPool<THREE.Object3D>(() => {
      const o = createTrackSegment();
      o.visible = false;
      this.group.add(o);
      return o;
    }, 3);

    this.archPool = new ObjectPool<THREE.Object3D>(() => {
      const o = buildArch();
      o.visible = false;
      this.group.add(o);
      return o;
    }, 2);

    this.ribPool = new ObjectPool<THREE.Object3D>(() => {
      const o = buildTunnelRib();
      o.visible = false;
      this.group.add(o);
      return o;
    }, 8);

    // ── Skyline ─────────────────────────────────────────────────────
    this.buildings = new THREE.InstancedMesh(unitBox(), Mat.building, BUILDING_SLOTS);
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.frustumCulled = false;
    this.buildings.castShadow = false;
    this.buildings.receiveShadow = false;
    this.group.add(this.buildings);

    this.windows = new THREE.InstancedMesh(windowBandGeometry(), Mat.window, BUILDING_SLOTS * 4);
    this.windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.windows.frustumCulled = false;
    this.group.add(this.windows);

    this.towers = new THREE.InstancedMesh(unitBox(), Mat.buildingFar, TOWER_SLOTS);
    this.towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.towers.frustumCulled = false;
    this.group.add(this.towers);

    for (let i = 0; i < BUILDING_SLOTS; i++) this.buildingSlots.push(this.makeBuilding(i, false));
    for (let i = 0; i < TOWER_SLOTS; i++) this.towerSlots.push(this.makeBuilding(i, true));

    // ── Atmosphere ──────────────────────────────────────────────────
    const motes = buildMotes();
    this.motes = motes.points;
    this.moteMaterial = motes.material;
    this.group.add(this.motes);

    this.reset();
  }

  reset(): void {
    for (const s of this.segments) {
      s.object.visible = false;
      this.segmentPool.release(s.object);
    }
    this.segments.length = 0;
    for (const a of this.arches) {
      a.object.visible = false;
      this.archPool.release(a.object);
    }
    this.arches.length = 0;

    for (const r of this.ribs) {
      r.object.visible = false;
      this.ribPool.release(r.object);
    }
    this.ribs.length = 0;
    this.tunnels.length = 0;
    this.buildingTunnel = null;
    this.nextFeatureZ = -300;
    this.nextRibZ = 0;

    this.nextSegmentZ = DESPAWN_BEHIND;
    this.nextArchZ = -70;
    while (this.nextSegmentZ > -VIEW_DISTANCE) this.addSegment();

    for (let i = 0; i < this.buildingSlots.length; i++) {
      this.buildingSlots[i] = this.makeBuilding(i, false);
    }
    for (let i = 0; i < this.towerSlots.length; i++) {
      this.towerSlots[i] = this.makeBuilding(i, true);
    }
  }

  update(deltaZ: number, time: number): void {
    // ── Deck ────────────────────────────────────────────────────────
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      s.z += deltaZ;
      s.object.position.z = s.z;
      if (s.z - SEGMENT_LENGTH / 2 > DESPAWN_BEHIND) {
        s.object.visible = false;
        this.segmentPool.release(s.object);
        this.segments.splice(i, 1);
      }
    }
    this.nextSegmentZ += deltaZ;
    while (this.nextSegmentZ > -VIEW_DISTANCE) this.addSegment();

    // ── Arch gates ──────────────────────────────────────────────────
    for (let i = this.arches.length - 1; i >= 0; i--) {
      const a = this.arches[i];
      a.z += deltaZ;
      a.object.position.z = a.z;
      if (a.z > DESPAWN_BEHIND + 6) {
        a.object.visible = false;
        this.archPool.release(a.object);
        this.arches.splice(i, 1);
      }
    }
    this.nextArchZ += deltaZ;
    while (this.nextArchZ > -VIEW_DISTANCE) {
      const object = this.archPool.acquire();
      object.visible = true;
      object.position.z = this.nextArchZ;
      this.arches.push({ object, z: this.nextArchZ });
      this.nextArchZ -= this.rng.range(95, 150);
    }

    this.updateTunnels(deltaZ);

    // ── Skyline ─────────────────────────────────────────────────────
    this.advanceSlots(this.buildingSlots, deltaZ, false);
    this.advanceSlots(this.towerSlots, deltaZ, true);
    this.writeBuildings();

    // ── Motes ───────────────────────────────────────────────────────
    this.moteMaterial.uniforms.uTime.value = time;
    this.moteMaterial.uniforms.uScroll.value =
      (this.moteMaterial.uniforms.uScroll.value + deltaZ * 0.55) % 120;
  }

  /**
   * Tunnel sections punctuate the run. They are laid out as a stream of
   * portal ribs rather than a single long mesh, so they pool and recycle
   * exactly like everything else and can be any length.
   */
  private updateTunnels(deltaZ: number): void {
    for (let i = this.ribs.length - 1; i >= 0; i--) {
      const r = this.ribs[i];
      r.z += deltaZ;
      r.object.position.z = r.z;
      if (r.z > DESPAWN_BEHIND + 6) {
        r.object.visible = false;
        this.ribPool.release(r.object);
        this.ribs.splice(i, 1);
      }
    }
    for (let i = this.tunnels.length - 1; i >= 0; i--) {
      const t = this.tunnels[i];
      t.start += deltaZ;
      t.end += deltaZ;
      // Retire on the far end, not the near one: the player is still
      // inside the section long after its mouth has gone past them.
      if (t.end > DESPAWN_BEHIND + 20) this.tunnels.splice(i, 1);
    }

    this.nextFeatureZ += deltaZ;
    this.nextRibZ += deltaZ;
    if (this.buildingTunnel) {
      this.buildingTunnel.start += deltaZ;
      this.buildingTunnel.end += deltaZ;
    }

    // Emit ribs while a section is being laid down.
    while (this.buildingTunnel && this.nextRibZ > -VIEW_DISTANCE
           && this.nextRibZ > this.buildingTunnel.end) {
      const object = this.ribPool.acquire();
      object.visible = true;
      object.position.z = this.nextRibZ;
      this.ribs.push({ object, z: this.nextRibZ });
      this.nextRibZ -= RIB_SPACING;
    }
    if (this.buildingTunnel && this.nextRibZ <= this.buildingTunnel.end) {
      this.tunnels.push(this.buildingTunnel);
      this.buildingTunnel = null;
    }

    // Open sky for a while, then another tunnel.
    if (!this.buildingTunnel && this.nextFeatureZ > -VIEW_DISTANCE) {
      const start = this.nextFeatureZ;
      const length = this.rng.range(110, 190);
      this.buildingTunnel = { start, end: start - length };
      this.nextRibZ = start;
      this.nextFeatureZ = start - length - this.rng.range(320, 560);
    }
  }

  /**
   * How enclosed the player currently is, 0…1, with a soft ramp at each
   * mouth so the lighting change reads as driving into something rather
   * than as a switch being flipped.
   */
  get enclosure(): number {
    const RAMP = 22;
    let best = 0;
    for (const t of this.tunnels) {
      if (0 > t.start || 0 < t.end) continue;
      const fromStart = t.start - 0;
      const fromEnd = 0 - t.end;
      const v = Math.min(1, Math.min(fromStart, fromEnd) / RAMP);
      if (v > best) best = v;
    }
    return best;
  }

  private addSegment(): void {
    const object = this.segmentPool.acquire();
    object.visible = true;
    object.position.z = this.nextSegmentZ;
    this.segments.push({ object, z: this.nextSegmentZ });
    this.nextSegmentZ -= SEGMENT_LENGTH;
  }

  private makeBuilding(index: number, far: boolean): Slot {
    const side = index % 2 === 0 ? -1 : 1;
    const spacing = far ? 34 : 22;
    const z = -((index * spacing) / 2) - this.rng.range(0, 10);
    return this.randomiseSlot({ z, x: 0, width: 0, depth: 0, height: 0, windows: 0 }, side, far);
  }

  private randomiseSlot(slot: Slot, side: number, far: boolean): Slot {
    if (far) {
      slot.width = this.rng.range(10, 22);
      slot.depth = this.rng.range(10, 20);
      slot.height = this.rng.range(30, 86);
      slot.x = side * this.rng.range(48, 112);
    } else {
      slot.width = this.rng.range(5, 10);
      slot.depth = this.rng.range(6, 12);
      slot.height = this.rng.range(7, 24);
      slot.x = side * this.rng.range(TRACK_WIDTH / 2 + 8, 34);
    }
    slot.windows = far ? 0 : this.rng.int(2, 5);
    return slot;
  }

  private advanceSlots(slots: Slot[], deltaZ: number, far: boolean): void {
    const spacing = far ? 34 : 22;
    const span = slots.length * spacing * 0.5;
    for (const slot of slots) {
      slot.z += deltaZ;
      if (slot.z > DESPAWN_BEHIND + 30) {
        slot.z -= span;
        this.randomiseSlot(slot, Math.sign(slot.x) || 1, far);
      }
    }
  }

  private writeBuildings(): void {
    let w = 0;
    for (let i = 0; i < this.buildingSlots.length; i++) {
      const s = this.buildingSlots[i];
      this.dummy.position.set(s.x, s.height / 2 - 6, s.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s.width, s.height, s.depth);
      this.dummy.updateMatrix();
      this.buildings.setMatrixAt(i, this.dummy.matrix);

      // Window bands climb the facade facing the track.
      for (let k = 0; k < s.windows && w < this.windows.count; k++) {
        const y = s.height / 2 - 6 - s.height * 0.34 + (k + 1) * (s.height / (s.windows + 1.4));
        this.dummy.position.set(
          s.x - Math.sign(s.x) * (s.width / 2 + 0.06),
          y,
          s.z,
        );
        this.dummy.rotation.set(0, Math.PI / 2, 0);
        this.dummy.scale.set(s.depth * 0.8, 1, 1);
        this.dummy.updateMatrix();
        this.windows.setMatrixAt(w++, this.dummy.matrix);
      }
    }
    // Park unused window instances out of sight rather than resizing.
    for (; w < this.windows.count; w++) {
      this.dummy.position.set(0, -9999, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.windows.setMatrixAt(w, this.dummy.matrix);
    }
    this.buildings.instanceMatrix.needsUpdate = true;
    this.windows.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.towerSlots.length; i++) {
      const s = this.towerSlots[i];
      this.dummy.position.set(s.x, s.height / 2 - 14, s.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s.width, s.height, s.depth);
      this.dummy.updateMatrix();
      this.towers.setMatrixAt(i, this.dummy.matrix);
    }
    this.towers.instanceMatrix.needsUpdate = true;
  }
}

function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  return g;
}

function windowBandGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 0.5);
}

/** Gate straddling the track — the run's rhythmic landmark. */
function buildArch(): THREE.Object3D {
  const group = new THREE.Group();
  const halfW = TRACK_WIDTH / 2 + 0.4;

  const frame: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    frame.push(g);
  };
  for (const s of [-1, 1]) {
    add(0.5, 6.4, 0.7, s * halfW, 3.2);
    add(0.9, 0.5, 1.1, s * halfW, 0.25);
  }
  add(halfW * 2 + 0.5, 0.75, 0.7, 0, 6.4);
  add(halfW * 2 - 1.4, 0.35, 0.4, 0, 5.6);

  const merged = mergeGeometries(frame, false)!;
  for (const g of frame) g.dispose();
  const mesh = new THREE.Mesh(merged, Mat.archFrame);
  mesh.castShadow = true;
  group.add(mesh);

  const strip = new THREE.Mesh(Geo.box(halfW * 2 - 1.5, 0.11, 0.12), Mat.archGlow);
  strip.position.set(0, 5.95, 0.36);
  group.add(strip);

  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(Geo.box(0.12, 5.4, 0.1), Mat.archGlow);
    post.position.set(s * (halfW - 0.32), 3.1, 0.36);
    group.add(post);
  }

  // Sign panel — abstract glyph blocks, never legible text. Structural
  // material, not the hazard one: coral has to mean "danger" and only
  // that, or the player learns to ignore it.
  const panel = new THREE.Mesh(Geo.box(3.2, 0.9, 0.14), Mat.archFrame);
  panel.position.set(0, 7.15, 0);
  group.add(panel);
  for (let i = 0; i < 4; i++) {
    const glyph = new THREE.Mesh(Geo.box(0.42, 0.42, 0.05), Mat.archGlow);
    glyph.position.set(-1.1 + i * 0.72, 7.15, 0.1);
    glyph.scale.y = 0.5 + ((i * 37) % 5) * 0.15;
    group.add(glyph);
  }

  return group;
}

/**
 * One rib of a tunnel section: a portal frame with a lit ceiling slot.
 * Ribs are spaced far enough apart to stay readable — the point is to
 * change the feeling of the space, not to hide the hazards inside it.
 */
function buildTunnelRib(): THREE.Object3D {
  const half = TRACK_WIDTH / 2 + 0.7;
  const b = new PartBuilder();

  for (const s of [-1, 1]) {
    b.box(Mat.rail, 0.7, 6.2, 1.1, s * half, 3.1);
    b.box(Mat.archGlow, 0.12, 4.6, 0.16, s * (half - 0.4), 2.9, 0.5);
  }
  b.box(Mat.rail, half * 2 + 0.7, 0.8, 1.1, 0, 6.4);
  // Ceiling light slot: the only warm-free light source overhead, which
  // is what makes the deck read as enclosed.
  b.box(Mat.archGlow, 1.1, 0.1, 0.9, 0, 5.94);

  return b.build('tunnelRib');
}

/** Slow-drifting light motes: cheap volume, no post-processing needed. */
function buildMotes(): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const count = 260;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 60;
    positions[i * 3 + 1] = Math.random() * 16 - 1;
    positions[i * 3 + 2] = -Math.random() * 120;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uColor: { value: new THREE.Color(Palette.cyan) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScroll;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.z = mod(p.z + uScroll + 120.0, 120.0) - 120.0;
        p.y += sin(uTime * 0.5 + p.x * 0.3) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vAlpha = smoothstep(120.0, 20.0, d) * smoothstep(2.0, 12.0, d) * 0.5;
        gl_PointSize = 46.0 / d;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material };
}
