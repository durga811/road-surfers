import * as THREE from 'three';
import { ObstacleManager } from './ObstacleManager';
import { CollectibleManager } from './CollectibleManager';
import { EnvironmentManager } from './EnvironmentManager';
import { ProceduralGenerator } from './ProceduralGenerator';
import { Random } from '../core/Random';
import { VIEW_DISTANCE } from '../core/Config';

/** Metres of guaranteed-clear runway at the start of every run. */
const RUNWAY = 44;

/**
 * Owns the spawn cursor and drives every world subsystem with the same
 * per-frame scroll delta, so the deck, hazards, coins and skyline can
 * never drift out of sync.
 */
export class TrackManager {
  readonly group = new THREE.Group();
  readonly obstacles = new ObstacleManager();
  readonly collectibles = new CollectibleManager();
  readonly environment = new EnvironmentManager();

  private readonly generator: ProceduralGenerator;
  private cursorZ = -RUNWAY;

  constructor(rng: Random) {
    this.generator = new ProceduralGenerator(rng);
    this.group.add(this.environment.group);
    this.group.add(this.obstacles.group);
    this.group.add(this.collectibles.group);
  }

  reset(): void {
    this.obstacles.clear();
    this.collectibles.clear();
    this.environment.reset();
    this.generator.reset();
    this.cursorZ = -RUNWAY;
  }

  update(
    dt: number,
    deltaZ: number,
    time: number,
    tier: number,
    speed: number,
    playerX: number,
    playerY: number,
    magnet: boolean,
    generate: boolean,
  ): void {
    this.environment.update(deltaZ, time);
    this.obstacles.update(deltaZ, time);
    this.collectibles.update(dt, deltaZ, time, playerX, playerY, magnet);

    this.cursorZ += deltaZ;
    if (!generate) return;

    // Keep the pipeline full: one pattern per iteration until the world
    // is populated out to the view distance.
    let guard = 0;
    while (this.cursorZ > -VIEW_DISTANCE && guard++ < 6) {
      const chunk = this.generator.next(tier, speed);
      for (const o of chunk.obstacles) {
        this.obstacles.spawn(o.type, o.lane, this.cursorZ - o.z);
      }
      for (const c of chunk.coins) {
        this.collectibles.spawnCoin(c.lane, c.y, this.cursorZ - c.z);
      }
      if (chunk.powerUp) {
        this.collectibles.spawnPowerUp(chunk.powerUp.kind, chunk.powerUp.lane, this.cursorZ - chunk.powerUp.z);
      }
      this.cursorZ -= chunk.length;
    }
  }
}
