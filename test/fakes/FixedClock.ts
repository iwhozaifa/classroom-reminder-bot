import type { Instant } from '../../src/core/types.js';
import type { Clock } from '../../src/ports/Clock.js';

export class FixedClock implements Clock {
  constructor(private current: Instant) {}

  now(): Instant {
    return this.current;
  }

  advanceTo(next: Instant): void {
    this.current = next;
  }
}
