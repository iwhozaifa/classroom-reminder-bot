import type { Instant } from '../core/types.js';

export interface Clock {
  now(): Instant;
}
