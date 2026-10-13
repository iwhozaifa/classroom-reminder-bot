import { parsePushEnvelope } from '../adapters/pubsub/pubsubEnvelope.js';
import { isCoveredBySync } from '../core/pushCoverage.js';
import type { Instant } from '../core/types.js';
import { runSyncReminders } from './syncReminders.js';
import type { SyncRemindersDeps } from './syncReminders.js';

/** Allowance for Classroom read-after-write lag — see core/pushCoverage.ts. */
const DEFAULT_COVERAGE_MARGIN_MS = 5_000;

const SYNC_MARK_PREFIX = 'push.lastSyncStartedAt.';

/** Tiny string store for per-course sync marks — Script Properties in production. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface PushRequest {
  body: string;
  /** The `?token=` query parameter on the push endpoint URL, or null if absent. */
  token: string | null;
}

export interface PushSyncDeps extends Omit<SyncRemindersDeps, 'onlyCourseId' | 'recordSyncStart'> {
  expectedToken: string;
  decodeBase64: (data: string) => string;
  marks: KeyValueStore;
  coverageMarginMs?: number;
}

export type PushOutcome = 'rejected' | 'malformed' | 'covered' | 'skipped' | 'synced';

/**
 * Builds the `recordSyncStart` hook both the sweep and the push path pass into
 * runSyncReminders, so a sweep also marks courses as freshly read and lets
 * already-covered pushes be dropped.
 */
export function syncStartRecorder(
  marks: KeyValueStore,
): (courseIds: string[], startedAt: Instant) => void {
  return (courseIds, startedAt) => {
    for (const courseId of courseIds) marks.set(SYNC_MARK_PREFIX + courseId, String(startedAt));
  };
}

/**
 * The `doPost` handler body. Pub/Sub delivers at least once, and the web app is
 * anonymous, so: reject a wrong token, ignore anything unparseable, skip anything a
 * sync already read past, otherwise run a normal full sync for the users following
 * that course. Every outcome is logged; nothing here signals failure back to
 * Pub/Sub (Apps Script can't return a non-2xx), so a missed push is ultimately
 * covered by the periodic safety-net sweep.
 */
export function handlePushNotification(request: PushRequest, deps: PushSyncDeps): PushOutcome {
  const { logger, marks } = deps;

  if (!tokensMatch(request.token, deps.expectedToken)) {
    logger.log('WARN', 'push', 'Rejected push with missing or wrong token');
    return 'rejected';
  }

  const event = parsePushEnvelope(request.body, deps.decodeBase64);
  if (event === null) {
    logger.log('WARN', 'push', 'Ignored malformed push body');
    return 'malformed';
  }

  const lastMark = marks.get(SYNC_MARK_PREFIX + event.courseId);
  const lastSyncStartedAt = lastMark === null || lastMark === '' ? null : Number(lastMark);
  const context = {
    courseId: event.courseId,
    collection: event.collection,
    eventType: event.eventType,
  };
  if (
    isCoveredBySync(
      event.publishedAt,
      lastSyncStartedAt,
      deps.coverageMarginMs ?? DEFAULT_COVERAGE_MARGIN_MS,
    )
  ) {
    logger.log('INFO', 'push', 'Push already covered by a later sync, skipping', context);
    return 'covered';
  }

  const ran = runSyncReminders({
    ...deps,
    onlyCourseId: event.courseId,
    recordSyncStart: syncStartRecorder(marks),
  });
  logger.log(
    'INFO',
    'push',
    ran ? 'Push-triggered sync completed' : 'Push-triggered sync skipped (lock busy)',
    context,
  );
  return ran ? 'synced' : 'skipped';
}

/** Constant-time over the expected token's length, so response timing doesn't leak a prefix match. */
function tokensMatch(actual: string | null, expected: string): boolean {
  if (actual === null || expected === '') return false;
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    diff |= (actual.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}
