/**
 * Generic free-list pool. Instances are created lazily up to `warm`
 * entries at construction, then reused for the lifetime of the game so
 * the main loop never allocates.
 */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly reset?: (item: T) => void;

  constructor(factory: () => T, warm = 0, reset?: (item: T) => void) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < warm; i++) this.free.push(factory());
  }

  acquire(): T {
    return this.free.pop() ?? this.factory();
  }

  release(item: T): void {
    this.reset?.(item);
    this.free.push(item);
  }
}
