import type { Lock } from '../../src/infra/lock.js';

export class FakeLock implements Lock {
  acquireCalls = 0;
  released = false;

  constructor(private readonly available: boolean = true) {}

  tryAcquire(_timeoutMs: number): boolean {
    this.acquireCalls++;
    return this.available;
  }

  release(): void {
    this.released = true;
  }
}
