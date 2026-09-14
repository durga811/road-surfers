import * as THREE from 'three';
import { Geo } from '../render/Geometries';
import { Mat } from '../render/Materials';
import { Palette } from '../render/Palette';
import { ObjectPool } from '../core/ObjectPool';
import {
  COIN_PICKUP_CENTRE,
  COIN_PICKUP_X,
  COIN_PICKUP_Y,
  COIN_PICKUP_Z,
  DESPAWN_COIN,
  LANE_WIDTH,
  MAGNET_RADIUS,
} from '../core/Config';
import { PowerUpKind } from './ProceduralGenerator';
import { clamp } from '../core/MathUtils';

const MAX_COINS = 320;

interface Coin {
  x: number;
  y: number;
  z: number;
  prevZ: number;
  spin: number;
  pulled: number;
}

export interface PowerUpInstance {
  kind: PowerUpKind;
  object: THREE.Object3D;
  x: number;
  z: number;
  prevZ: number;
}

/**
 * Coins are drawn as a single InstancedMesh — a few hundred of them
 * cost exactly one draw call, and the per-frame work is a matrix
 * compose rather than a scene-graph traversal.
 */
export class CollectibleManager {
  readonly group = new THREE.Group();
  readonly coins: Coin[] = [];
  readonly powerUps: PowerUpInstance[] = [];

  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly coinPool: Coin[] = [];
  private readonly powerPools = new Map<PowerUpKind, ObjectPool<THREE.Object3D>>();
  private readonly powerRecords: PowerUpInstance[] = [];

  constructor() {
    this.group.name = 'collectibles';

    this.mesh = new THREE.InstancedMesh(Geo.octahedron(0.33, 0), Mat.coin, MAX_COINS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    for (const kind of ['magnet', 'shield', 'surge'] as PowerUpKind[]) {
      this.powerPools.set(
        kind,
        new ObjectPool<THREE.Object3D>(() => {
          const o = buildPowerUp(kind);
          o.visible = false;
          this.group.add(o);
          return o;
        }, 1),
      );
    }
  }

  spawnCoin(lane: number, y: number, z: number): void {
    if (this.coins.length >= MAX_COINS) return;
    const coin = this.coinPool.pop() ?? ({} as Coin);
    coin.x = (lane - 1) * LANE_WIDTH;
    coin.y = y;
    coin.z = z;
    coin.prevZ = z;
    coin.spin = Math.random() * Math.PI * 2;
    coin.pulled = 0;
    this.coins.push(coin);
  }

  spawnPowerUp(kind: PowerUpKind, lane: number, z: number): void {
    const object = this.powerPools.get(kind)!.acquire();
    object.visible = true;
    const record = this.powerRecords.pop() ?? ({} as PowerUpInstance);
    record.kind = kind;
    record.object = object;
    record.x = (lane - 1) * LANE_WIDTH;
    record.z = z;
    record.prevZ = z;
    object.position.set(record.x, 1.0, z);
    this.powerUps.push(record);
  }

  update(dt: number, deltaZ: number, time: number, playerX: number, playerY: number, magnet: boolean): void {
    // ── Coins ───────────────────────────────────────────────────────
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.prevZ = coin.z;
      coin.z += deltaZ;

      if (magnet) {
        const dx = playerX - coin.x;
        const dy = playerY + COIN_PICKUP_CENTRE - coin.y;
        const dz = -coin.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < MAGNET_RADIUS * MAGNET_RADIUS) {
          const pull = clamp(1 - Math.sqrt(distSq) / MAGNET_RADIUS, 0, 1);
          coin.pulled = Math.max(coin.pulled, pull);
          const k = Math.min(1, dt * (5 + pull * 22));
          coin.x += dx * k;
          coin.y += dy * k;
          coin.z += dz * k;
        }
      }

      if (coin.z > DESPAWN_COIN) this.recycleCoin(i);
    }

    // Rebuild the instance buffer once per frame.
    const spin = time * 2.1;
    let count = 0;
    for (let i = 0; i < this.coins.length && count < MAX_COINS; i++) {
      const coin = this.coins[i];
      this.dummy.position.set(coin.x, coin.y + Math.sin(time * 2.4 + coin.spin) * 0.09, coin.z);
      this.dummy.rotation.set(0.32, spin + coin.spin, 0);
      // Missed coins shrink away just behind the player instead of
      // ballooning through the camera on their way past.
      const fade = coin.z > 1.2 ? Math.max(0, 1 - (coin.z - 1.2) / 2.4) : 1;
      const s = (1 + coin.pulled * 0.22) * fade * fade;
      this.dummy.scale.set(s, s * 1.25, s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count;
    if (count > 0) this.mesh.instanceMatrix.needsUpdate = true;

    // ── Power-ups ───────────────────────────────────────────────────
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const p = this.powerUps[i];
      p.prevZ = p.z;
      p.z += deltaZ;
      p.object.position.z = p.z;
      p.object.position.y = 1.0 + Math.sin(time * 2 + p.x) * 0.12;
      p.object.rotation.y = time * 1.3;
      const fade = p.z > 1.2 ? Math.max(0, 1 - (p.z - 1.2) / 2.4) : 1;
      p.object.scale.setScalar(fade);
      p.object.children[0].rotation.x = time * 0.9;
      if (p.z > DESPAWN_COIN) this.recyclePowerUp(i);
    }
  }

  /** Returns the number of coins collected this frame. */
  collect(playerX: number, playerY: number, onCollect: (x: number, y: number, z: number) => void): number {
    let collected = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      // Swept in Z: at 29 m/s a coin travels half a metre per frame.
      const crossed = coin.prevZ <= COIN_PICKUP_Z && coin.z >= -COIN_PICKUP_Z;
      if (!crossed) continue;
      if (Math.abs(coin.x - playerX) > COIN_PICKUP_X) continue;
      if (Math.abs(coin.y - (playerY + COIN_PICKUP_CENTRE)) > COIN_PICKUP_Y) continue;
      onCollect(coin.x, coin.y, coin.z);
      this.recycleCoin(i);
      collected++;
    }
    return collected;
  }

  collectPowerUps(playerX: number, playerY: number, onCollect: (kind: PowerUpKind, x: number, y: number) => void): void {
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const p = this.powerUps[i];
      const crossed = p.prevZ <= 1 && p.z >= -1;
      if (!crossed) continue;
      if (Math.abs(p.x - playerX) > 1.0) continue;
      if (playerY > 1.6) continue;
      onCollect(p.kind, p.x, 1.0);
      this.recyclePowerUp(i);
    }
  }

  private recycleCoin(index: number): void {
    const coin = this.coins[index];
    this.coins.splice(index, 1);
    this.coinPool.push(coin);
  }

  private recyclePowerUp(index: number): void {
    const p = this.powerUps[index];
    p.object.visible = false;
    this.powerPools.get(p.kind)!.release(p.object);
    this.powerUps.splice(index, 1);
    this.powerRecords.push(p);
  }

  clear(): void {
    while (this.coins.length) this.recycleCoin(this.coins.length - 1);
    while (this.powerUps.length) this.recyclePowerUp(this.powerUps.length - 1);
    this.mesh.count = 0;
  }
}

const haloCache = new Map<number, THREE.SpriteMaterial>();
function haloMaterial(color: number): THREE.SpriteMaterial {
  let mat = haloCache.get(color);
  if (!mat) {
    mat = new THREE.SpriteMaterial({
      map: radialSprite(),
      color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    haloCache.set(color, mat);
  }
  return mat;
}

let sharedSprite: THREE.Texture | null = null;
function radialSprite(): THREE.Texture {
  if (sharedSprite) return sharedSprite;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedSprite = new THREE.CanvasTexture(canvas);
  return sharedSprite;
}

const POWER_COLORS: Record<PowerUpKind, number> = {
  magnet: Palette.magnet,
  shield: Palette.shield,
  surge: Palette.surge,
};

/** Same silhouette for every power-up; only the core glyph and colour
 *  change, so they read as one family at a glance. */
function buildPowerUp(kind: PowerUpKind): THREE.Object3D {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(Geo.icosahedron(0.62, 0), Mat.powerShell);
  group.add(shell);

  const color = POWER_COLORS[kind];
  const glowMat = kind === 'magnet' ? Mat.magnet : kind === 'shield' ? Mat.shield : Mat.surge;

  const ring = new THREE.Mesh(Geo.torus(0.46, 0.05, 6, 20), glowMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  if (kind === 'magnet') {
    const core = new THREE.Mesh(Geo.torus(0.22, 0.08, 6, 14), glowMat);
    core.rotation.y = Math.PI / 2;
    group.add(core);
  } else if (kind === 'shield') {
    const core = new THREE.Mesh(Geo.icosahedron(0.26, 0), glowMat);
    group.add(core);
  } else {
    for (let i = 0; i < 2; i++) {
      const chev = new THREE.Mesh(Geo.box(0.34, 0.09, 0.09), glowMat);
      chev.position.y = i * 0.18 - 0.09;
      chev.rotation.z = Math.PI / 4;
      group.add(chev);
      const chev2 = new THREE.Mesh(Geo.box(0.34, 0.09, 0.09), glowMat);
      chev2.position.set(0.24, i * 0.18 - 0.09, 0);
      chev2.rotation.z = -Math.PI / 4;
      group.add(chev2);
    }
  }

  // A soft additive halo instead of a real light: adding/removing point
  // lights forces material recompiles, and a stutter is worse than a
  // physically-correct falloff.
  const halo = new THREE.Sprite(haloMaterial(color));
  halo.scale.setScalar(2.0);
  group.add(halo);

  return group;
}
