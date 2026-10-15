import { describe, expect, it } from 'vitest';
import { SheetConfigStore } from '../../src/adapters/sheets/SheetConfigStore.js';
import { SheetLogger } from '../../src/adapters/sheets/SheetLogger.js';
import { CONFIG_HEADERS } from '../../src/adapters/sheets/schema.js';
import type { Assignment } from '../../src/core/types.js';
import type { ClassroomSource } from '../../src/ports/ClassroomSource.js';
import { handlePushNotification, syncStartRecorder } from '../../src/triggers/pushSync.js';
import type { KeyValueStore } from '../../src/triggers/pushSync.js';
import { FakeAlerter } from '../fakes/FakeAlerter.js';
import { FakeLock } from '../fakes/FakeLock.js';
import { FakeSchedulingNotifier } from '../fakes/FakeSchedulingNotifier.js';
import { FakeSheet } from '../fakes/FakeSheet.js';
import { FixedClock } from '../fakes/FixedClock.js';
import { InMemoryDeliveryStore } from '../fakes/InMemoryDeliveryStore.js';
import { InMemoryReminderStore } from '../fakes/InMemoryReminderStore.js';

const TOKEN = 'push-secret';
const PUBLISHED = Date.UTC(2026, 0, 1, 12);
const decode = (data: string): string => Buffer.from(data, 'base64').toString('utf8');

class MapStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/** Records which users and course lists a sync actually read. */
class RecordingSource implements ClassroomSource {
  readonly calls: { userId: string; courseIds: string[] }[] = [];
  listAssignments(userId: string, courseIds: string[]): Assignment[] {
    this.calls.push({ userId, courseIds });
    return [];
  }
}

function pushBody(courseId: string, publishTime = new Date(PUBLISHED).toISOString()): string {
  const data = Buffer.from(
    JSON.stringify({
      collection: 'courses.courseWork',
      eventType: 'MODIFIED',
      resourceId: { courseId, id: 'cw-1' },
    }),
  ).toString('base64');
  return JSON.stringify({ message: { data, publishTime, messageId: '1' } });
}

function makeDeps(lock = new FakeLock(true)) {
  const configSheet = new FakeSheet('Config');
  configSheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([[...CONFIG_HEADERS]]);
  configSheet
    .getRange(2, 1, 1, 13)
    .setValues([['u1', 'One', 'UTC', 'c1,c2', 'slack', '', '', false, '', '', 7, 0, true]]);
  configSheet
    .getRange(3, 1, 1, 13)
    .setValues([['u2', 'Two', 'UTC', 'c3', 'slack', '', '', false, '', '', 7, 0, true]]);
  const logSheet = new FakeSheet('Log');
  const clock = new FixedClock(PUBLISHED + 60_000);
  const source = new RecordingSource();
  const marks = new MapStore();
  return {
    deps: {
      lock,
      clock,
      logger: new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock),
      configStore: new SheetConfigStore(
        configSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      ),
      source,
      reminderStore: new InMemoryReminderStore(),
      deliveryStore: new InMemoryDeliveryStore(),
      notifiers: { slack: new FakeSchedulingNotifier() },
      alerter: new FakeAlerter(),
      expectedToken: TOKEN,
      decodeBase64: decode,
      marks,
    },
    source,
    marks,
    logSheet,
  };
}

describe('handlePushNotification', () => {
  it("syncs only users following the pushed course, over all of that user's courses", () => {
    const { deps, source } = makeDeps();

    const outcome = handlePushNotification({ body: pushBody('c2'), token: TOKEN }, deps);

    expect(outcome).toBe('synced');
    expect(source.calls).toEqual([{ userId: 'u1', courseIds: ['c1', 'c2'] }]);
  });

  it('records a sync-start mark for every course the synced user follows', () => {
    const { deps, marks } = makeDeps();

    handlePushNotification({ body: pushBody('c1'), token: TOKEN }, deps);

    expect(marks.get('push.lastSyncStartedAt.c1')).toBe(String(PUBLISHED + 60_000));
    expect(marks.get('push.lastSyncStartedAt.c2')).toBe(String(PUBLISHED + 60_000));
    expect(marks.get('push.lastSyncStartedAt.c3')).toBeNull();
  });

  it('skips a redelivery of a push an earlier sync already read past', () => {
    const { deps, source } = makeDeps();
    handlePushNotification({ body: pushBody('c1'), token: TOKEN }, deps);

    const outcome = handlePushNotification({ body: pushBody('c1'), token: TOKEN }, deps);

    expect(outcome).toBe('covered');
    expect(source.calls).toHaveLength(1);
  });

  it('still syncs a newer push published after the last sync started', () => {
    const { deps, source } = makeDeps();
    handlePushNotification({ body: pushBody('c1'), token: TOKEN }, deps);
    deps.clock.advanceTo(PUBLISHED + 10 * 60_000);

    const later = new Date(PUBLISHED + 5 * 60_000).toISOString();
    const outcome = handlePushNotification({ body: pushBody('c1', later), token: TOKEN }, deps);

    expect(outcome).toBe('synced');
    expect(source.calls).toHaveLength(2);
  });

  it.each([
    ['missing', null],
    ['wrong', 'nope'],
    ['prefix of the real one', 'push-sec'],
  ])('rejects a %s token without syncing', (_label, token) => {
    const { deps, source, logSheet } = makeDeps();

    expect(handlePushNotification({ body: pushBody('c1'), token }, deps)).toBe('rejected');
    expect(source.calls).toHaveLength(0);
    expect(
      logSheet.rows.some((row) => row[1] === 'WARN' && String(row[3]).includes('Rejected')),
    ).toBe(true);
  });

  it('rejects everything when no expected token is configured', () => {
    const { deps } = makeDeps();

    expect(
      handlePushNotification({ body: pushBody('c1'), token: '' }, { ...deps, expectedToken: '' }),
    ).toBe('rejected');
  });

  it('ignores a malformed body without syncing', () => {
    const { deps, source } = makeDeps();

    expect(handlePushNotification({ body: '{"message":{}}', token: TOKEN }, deps)).toBe(
      'malformed',
    );
    expect(source.calls).toHaveLength(0);
  });

  it('reports "skipped" when the lock is busy', () => {
    const { deps, source } = makeDeps(new FakeLock(false));

    expect(handlePushNotification({ body: pushBody('c1'), token: TOKEN }, deps)).toBe('skipped');
    expect(source.calls).toHaveLength(0);
  });
});

describe('handlePushNotification — failed sync', () => {
  it('a push whose sync failed is not "covered" for its redelivery', () => {
    const { deps } = makeDeps();
    const failing = {
      ...deps,
      source: {
        listAssignments: (): Assignment[] => {
          throw new Error('Classroom 500');
        },
      },
    };

    expect(handlePushNotification({ body: pushBody('c1'), token: TOKEN }, failing)).toBe('synced');
    expect(handlePushNotification({ body: pushBody('c1'), token: TOKEN }, failing)).toBe('synced');
  });
});

describe('syncStartRecorder', () => {
  it('writes one mark per course', () => {
    const marks = new MapStore();

    syncStartRecorder(marks)(['a', 'b'], 42);

    expect([...marks.values.entries()]).toEqual([
      ['push.lastSyncStartedAt.a', '42'],
      ['push.lastSyncStartedAt.b', '42'],
    ]);
  });
});
