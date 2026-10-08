import type { Clock } from '../ports/Clock.js';

/** The one real Clock — everywhere else takes an injected Clock so tests can use FixedClock instead. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
