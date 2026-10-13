import type { Instant } from './types.js';

/**
 * Whether a push notification is already reflected by a sync that *started* after
 * the change was published — a sync reads Classroom fresh at its start, so anything
 * published before then was already seen. This is what collapses Pub/Sub's
 * at-least-once redeliveries and bursts (a teacher saving the same assignment five
 * times) into one sync, without ever dropping an event that arrived *after* the last
 * sync began, which a plain "at most once per N seconds" debounce would.
 *
 * `marginMs` allows for Classroom's own read-after-write lag: a sync starting only a
 * moment after the publish might not see the change yet, so it doesn't count.
 * Unknown last-sync time (never recorded, or evicted) is never "covered" — fail open.
 */
export function isCoveredBySync(
  publishedAt: Instant,
  lastSyncStartedAt: Instant | null,
  marginMs: number,
): boolean {
  return lastSyncStartedAt !== null && publishedAt + marginMs <= lastSyncStartedAt;
}
