import * as THREE from 'three';
import { Geo } from '../render/Geometries';
import { particleMaterial } from '../render/Materials';
import { Palette } from '../render/Palette';

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  spin: number;
  gravity: number;
  startScale: number;
  worldLocked: boolean;
}

const CAPACITY = 220;

/**
 * A fixed pool of small emissive shards. Every burst in the game —
 * coin pickup, landing dust, slide sparks, power-up flash, crash —
 * draws from the same pool with different colour, spread and gravity,
 * so effects always look like they belong to the same world.
 */
export class ParticleSystem {
  readonly group = new THREE.Group();

  private readonly pool: Particle[] = [];
  private readonly live: Particle[] = [];

  constructor() {
    this.group.name = 'particles';
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(Geo.box(0.14, 0.14, 0.14), particleMaterial(Palette.coin));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pool.push({
        mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1,
        spin: 0, gravity: 0, startScale: 1, worldLocked: true,
      });
    }
  }

  /**
   * @param worldLocked  true → the shard scrolls with the world (dust,
   *                     coin bursts); false → it stays with the player.
   */
  burst(
    x: number, y: number, z: number,
    count: number,
    color: number,
    options: {
      speed?: number; life?: number; gravity?: number;
      scale?: number; up?: number; spread?: number; worldLocked?: boolean;
    } = {},
  ): void {
    const speed = options.speed ?? 4;
    const life = options.life ?? 0.5;
    const gravity = options.gravity ?? 14;
    const scale = options.scale ?? 1;
    const up = options.up ?? 0.5;
    const spread = options.spread ?? 1;

    for (let i = 0; i < count; i++) {
      const p = this.pool.pop();
      if (!p) return;

      const theta = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      p.vx = Math.cos(theta) * r * speed;
      p.vz = Math.sin(theta) * r * speed;
      p.vy = (up + Math.random() * 0.9) * speed;
      p.life = life * (0.75 + Math.random() * 0.5);
      p.maxLife = p.life;
      p.spin = (Math.random() - 0.5) * 14;
      p.gravity = gravity;
      p.startScale = scale * (0.6 + Math.random() * 0.7);
      p.worldLocked = options.worldLocked ?? true;

      p.mesh.material = particleMaterial(color);
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      p.mesh.scale.setScalar(p.startScale);
      p.mesh.visible = true;
      this.live.push(p);
    }
  }

  update(dt: number, deltaZ: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }

      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt + (p.worldLocked ? deltaZ : 0);
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * 0.7 * dt;

      const t = p.life / p.maxLife;
      p.mesh.scale.setScalar(p.startScale * (0.25 + t * 0.75));
      if (p.mesh.position.y < 0.04) {
        p.mesh.position.y = 0.04;
        p.vy *= -0.32;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
  }

  clear(): void {
    for (const p of this.live) {
      p.mesh.visible = false;
      this.pool.push(p);
    }
    this.live.length = 0;
  }
}
