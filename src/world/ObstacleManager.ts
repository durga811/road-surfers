import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool';
import { DESPAWN_BEHIND, LANE_WIDTH } from '../core/Config';
import { obstacleCentreX, OBSTACLES, ObstacleDef, ObstacleType } from './ObstacleTypes';
import { CollisionTarget } from '../systems/CollisionSystem';

export interface ActiveObstacle extends CollisionTarget {
  def: ObstacleDef;
  object: THREE.Object3D;
  lane: number;
  /** Relative to the player: negative is ahead, positive is behind. */
  z: number;
  prevZ: number;
  x: number;
  baseX: number;
  phase: number;
  resolved: boolean;
  /** Node the motion is applied to — the whole prop, or just the part
   *  of it that moves (a sweeper's arm rides a fixed rail). */
  motionTarget: THREE.Object3D;
}

/**
 * Spawns, animates and recycles hazards. One pool per obstacle type;
 * meshes are built once and reused for the whole session, so a two
 * thousand metre run allocates nothing after the first few hundred.
 */
export class ObstacleManager {
  readonly group = new THREE.Group();
  readonly active: ActiveObstacle[] = [];

  private readonly pools = new Map<ObstacleType, ObjectPool<THREE.Object3D>>();
  private readonly recordPool: ActiveObstacle[] = [];

  constructor() {
    this.group.name = 'obstacles';
    for (const key of Object.keys(OBSTACLES) as ObstacleType[]) {
      const def = OBSTACLES[key];
      this.pools.set(
        key,
        new ObjectPool<THREE.Object3D>(
          () => {
            const o = def.build();
            o.visible = false;
            this.group.add(o);
            return o;
          },
          key === 'freight' || key === 'sweeper' || key === 'drone' ? 2 : 4,
        ),
      );
    }
  }

  spawn(type: ObstacleType, lane: number, z: number): void {
    const def = OBSTACLES[type];
    const object = this.pools.get(type)!.acquire();
    object.visible = true;

    const record = this.recordPool.pop() ?? ({} as ActiveObstacle);
    record.def = def;
    record.object = object;
    record.lane = lane;
    record.z = z;
    record.prevZ = z;
    record.phase = Math.random() * Math.PI * 2;
    record.resolved = false;
    record.motionTarget = object.getObjectByName('arm') ?? object;

    record.baseX = obstacleCentreX(def, lane);
    record.x = record.baseX;
    record.halfWidth = def.width / 2;
    record.halfDepth = def.depth / 2;
    record.minY = def.minY;
    record.maxY = def.maxY;

    object.position.set(record.x, 0, z);
    this.active.push(record);
  }

  /** @param deltaZ metres the world moved toward the player this frame. */
  update(deltaZ: number, time: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      o.prevZ = o.z;
      o.z += deltaZ;

      switch (o.def.motion) {
        case 'patrol': {
          // Drifts between the two lanes it owns — never into the third.
          o.x = o.baseX + Math.sin(time * 1.15 + o.phase) * (LANE_WIDTH * 0.5);
          o.object.position.x = o.x;
          o.object.position.y = Math.sin(time * 2.4 + o.phase) * 0.09;
          o.object.rotation.y = Math.sin(time * 1.15 + o.phase) * 0.22;
          break;
        }
        case 'sweep': {
          o.x = Math.sin(time * 1.5 + o.phase) * LANE_WIDTH;
          o.motionTarget.position.x = o.x;
          break;
        }
        default:
          break;
      }

      o.object.position.z = o.z;

      if (o.z > DESPAWN_BEHIND) this.recycle(i);
    }
  }

  /** Removes a hazard immediately — e.g. one the shield just shattered. */
  destroy(target: ActiveObstacle): void {
    const index = this.active.indexOf(target);
    if (index !== -1) this.recycle(index);
  }

  private recycle(index: number): void {
    const o = this.active[index];
    o.object.visible = false;
    o.object.position.set(0, 0, 0);
    o.object.rotation.set(0, 0, 0);
    o.motionTarget.position.x = 0;
    this.pools.get(o.def.type)!.release(o.object);
    this.active.splice(index, 1);
    this.recordPool.push(o);
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.recycle(i);
  }
}
