import { PLAYER_HALF_DEPTH } from '../core/Config';

export interface PlayerBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The minimum an obstacle must expose to be collidable. */
export interface CollisionTarget {
  x: number;
  z: number;
  prevZ: number;
  halfWidth: number;
  halfDepth: number;
  minY: number;
  maxY: number;
  resolved: boolean;
}

export interface CollisionResult<T extends CollisionTarget> {
  obstacle: T | null;
  nearMisses: T[];
}

/**
 * Swept AABB collision.
 *
 * At 29 m/s an obstacle covers roughly half a metre per frame, which is
 * comparable to the depth of a hurdle. Testing only the current frame's
 * position would let hazards tunnel straight through the player, so the
 * Z axis is tested as a swept interval while X and Y are ordinary
 * overlap tests.
 *
 * Deliberately free of any rendering dependency so the same code runs
 * in the headless soak test.
 */
export class CollisionSystem<T extends CollisionTarget = CollisionTarget> {
  private readonly nearMisses: T[] = [];

  check(bounds: PlayerBounds, obstacles: readonly T[]): CollisionResult<T> {
    this.nearMisses.length = 0;
    let hit: T | null = null;

    const playerCentreX = (bounds.minX + bounds.maxX) / 2;
    const playerHalfW = (bounds.maxX - bounds.minX) / 2;

    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.resolved) continue;

      // Swept Z: did the obstacle's slab cross the player's slab at any
      // point between the previous frame and this one?
      const sweepMin = Math.min(o.prevZ, o.z) - o.halfDepth;
      const sweepMax = Math.max(o.prevZ, o.z) + o.halfDepth;
      if (sweepMax < -PLAYER_HALF_DEPTH || sweepMin > PLAYER_HALF_DEPTH) continue;

      const overlapX = bounds.maxX > o.x - o.halfWidth && bounds.minX < o.x + o.halfWidth;
      const overlapY = bounds.maxY > o.minY && bounds.minY < o.maxY;

      if (overlapX && overlapY) {
        if (!hit) hit = o;
        o.resolved = true;
        continue;
      }

      // Cleared it — but by how much?
      if (o.prevZ < 0 && o.z >= 0) {
        o.resolved = true;
        const gapX = Math.max(0, Math.abs(o.x - playerCentreX) - (o.halfWidth + playerHalfW));
        const gapY = overlapX
          ? Math.max(0, o.minY > bounds.maxY ? o.minY - bounds.maxY : bounds.minY - o.maxY)
          : Infinity;
        if (gapX < 0.42 || gapY < 0.34) this.nearMisses.push(o);
      }
    }

    return { obstacle: hit, nearMisses: this.nearMisses };
  }
}
