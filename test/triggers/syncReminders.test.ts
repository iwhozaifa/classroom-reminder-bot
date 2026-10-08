import { describe, expect, it } from 'vitest';
import { runSyncReminders } from '../../src/triggers/syncReminders.js';
import { SheetConfigStore } from '../../src/adapters/sheets/SheetConfigStore.js';
import { SheetLogger } from '../../src/adapters/sheets/SheetLogger.js';
import { CONFIG_HEADERS } from '../../src/adapters/sheets/schema.js';
import type { Assignment } from '../../src/core/types.js';
import type { ClassroomSource } from '../../src/ports/ClassroomSource.js';
import { FakeAlerter } from '../fakes/FakeAlerter.js';
import { FakeLock } from '../fakes/FakeLock.js';
import { FakeSchedulingNotifier } from '../fakes/FakeSchedulingNotifier.js';
import { FakeSheet } from '../fakes/FakeSheet.js';
import { FixedClock } from '../fakes/FixedClock.js';
import { InMemoryDeliveryStore } from '../fakes/InMemoryDeliveryStore.js';
import { InMemoryReminderStore } from '../fakes/InMemoryReminderStore.js';

function makeConfigSheet(rows: unknown[][]): FakeSheet {
  const sheet = new FakeSheet('Config');
  sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([[...CONFIG_HEADERS]]);
  for (const [index, row] of rows.entries()) sheet.getRange(2 + index, 1, 1, row.length).setValues([row]);
  return sheet;
}

const ROW_ACTIVE = ['u1', 'Student One', 'Asia/Karachi', '', 'slack', '', '', false, '', '', 7, 0, true];
const ROW_INACTIVE = ['u2', 'Student Two', 'Asia/Karachi', '', 'slack', '', '', false, '', '', 7, 0, false];

class ThrowingClassroomSource implements ClassroomSource {
  listAssignments(userId: string, _courseIds: string[]): Assignment[] {
    if (userId === 'u1') throw new Error('Classroom is down');
    return [];
  }
}

class EmptyClassroomSource implements ClassroomSource {
  listAssignments(_userId: string, _courseIds: string[]): Assignment[] {
    return [];
  }
}

/** Lets a single test flip between failing and succeeding across successive runSyncReminders() calls. */
class SwitchableClassroomSource implements ClassroomSource {
  current: ClassroomSource = new ThrowingClassroomSource();
  listAssignments(userId: string, courseIds: string[]): Assignment[] {
    return this.current.listAssignments(userId, courseIds);
  }
}

function baseDeps(configRows: unknown[][], source: ClassroomSource) {
  const logSheet = new FakeSheet('Log');
  const clock = new FixedClock(Date.UTC(2026, 0, 1));
  return {
    lock: new FakeLock(true),
    clock,
    logger: new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock),
    configStore: new SheetConfigStore(makeConfigSheet(configRows) as unknown as GoogleAppsScript.Spreadsheet.Sheet),
    source,
    reminderStore: new InMemoryReminderStore(),
    deliveryStore: new InMemoryDeliveryStore(),
    notifiers: { slack: new FakeSchedulingNotifier() },
    alerter: new FakeAlerter(),
    logSheet,
  };
}

describe('runSyncReminders — locking', () => {
  it('skips the whole cycle and logs a "lock not acquired" entry when the lock is unavailable', () => {
    const deps = baseDeps([ROW_ACTIVE], new EmptyClassroomSource());
    const lock = new FakeLock(false);

    runSyncReminders({ ...deps, lock });

    expect(lock.acquireCalls).toBe(1);
    const warnRow = deps.logSheet.rows.find((row) => row[1] === 'WARN');
    expect(warnRow).toBeDefined();
    expect(String(warnRow![3])).toContain('Lock not acquired');
  });

  it('releases the lock even when a sync cycle throws', () => {
    const lock = new FakeLock(true);
    const deps = baseDeps([ROW_ACTIVE], new ThrowingClassroomSource());

    runSyncReminders({ ...deps, lock });

    expect(lock.released).toBe(true);
  });

  it('releases the lock normally on a clean run', () => {
    const lock = new FakeLock(true);
    const deps = baseDeps([ROW_ACTIVE], new EmptyClassroomSource());

    runSyncReminders({ ...deps, lock });

    expect(lock.released).toBe(true);
  });
});

describe('runSyncReminders — per-user isolation', () => {
  it('skips inactive Config rows entirely', () => {
    const deps = baseDeps([ROW_INACTIVE], new ThrowingClassroomSource());

    expect(() => runSyncReminders(deps)).not.toThrow();
    expect(deps.logSheet.rows.some((row) => row[1] === 'ERROR')).toBe(false);
  });

  it('logs an ERROR for a user whose sync cycle throws, without crashing the whole run or skipping other users', () => {
    const deps = baseDeps([ROW_ACTIVE, configRowFor('u3')], new ThrowingClassroomSource());

    expect(() => runSyncReminders(deps)).not.toThrow();

    const errorRow = deps.logSheet.rows.find((row) => row[1] === 'ERROR');
    expect(errorRow).toBeDefined();
    expect(String(errorRow![4])).toContain('u1');
    const infoRow = deps.logSheet.rows.find((row) => row[1] === 'INFO' && String(row[4]).includes('u3'));
    expect(infoRow).toBeDefined();
  });
});

function configRowFor(userId: string): unknown[] {
  return [userId, 'Another User', 'Asia/Karachi', '', 'slack', '', '', false, '', '', 7, 0, true];
}

describe('runSyncReminders — two-strikes watchdog', () => {
  it('increments and persists the failure count on the first failure, without alerting yet', () => {
    const deps = baseDeps([ROW_ACTIVE], new ThrowingClassroomSource());

    runSyncReminders(deps);

    expect(deps.alerter.errorAlerts).toHaveLength(0);
    expect(deps.configStore.loadAll()[0]).toMatchObject({ userId: 'u1', consecutiveFailureCount: 1 });
  });

  it('sends exactly one error alert once the failure count reaches the threshold (2)', () => {
    const deps = baseDeps([ROW_ACTIVE], new ThrowingClassroomSource());

    runSyncReminders(deps); // failure #1 — silent
    runSyncReminders(deps); // failure #2 — alerts

    expect(deps.alerter.errorAlerts).toHaveLength(1);
    expect(deps.configStore.loadAll()[0]).toMatchObject({ consecutiveFailureCount: 2 });
  });

  it('keeps alerting on every subsequent failing run past the threshold, not just the 2nd', () => {
    const deps = baseDeps([ROW_ACTIVE], new ThrowingClassroomSource());

    runSyncReminders(deps); // #1 silent
    runSyncReminders(deps); // #2 alerts
    runSyncReminders(deps); // #3 alerts again

    expect(deps.alerter.errorAlerts).toHaveLength(2);
    expect(deps.configStore.loadAll()[0]).toMatchObject({ consecutiveFailureCount: 3 });
  });

  it('resets the failure count to 0 on the next successful cycle, stopping further alerts', () => {
    const source = new SwitchableClassroomSource();
    const deps = baseDeps([ROW_ACTIVE], source);

    runSyncReminders(deps); // #1 silent
    runSyncReminders(deps); // #2 alerts
    source.current = new EmptyClassroomSource();
    runSyncReminders(deps); // recovers

    expect(deps.configStore.loadAll()[0]).toMatchObject({ consecutiveFailureCount: 0 });

    source.current = new ThrowingClassroomSource();
    runSyncReminders(deps); // fresh failure #1 after recovery — silent again

    expect(deps.alerter.errorAlerts).toHaveLength(1); // still just the one from before recovery
    expect(deps.configStore.loadAll()[0]).toMatchObject({ consecutiveFailureCount: 1 });
  });

  it('logs (but does not crash the run on) a failure to send the watchdog alert itself', () => {
    const deps = baseDeps([ROW_ACTIVE], new ThrowingClassroomSource());
    runSyncReminders(deps); // #1 — silent
    deps.alerter.throwOnNextAlert();

    expect(() => runSyncReminders(deps)).not.toThrow(); // #2 — alert attempted and fails

    expect(deps.alerter.errorAlerts).toHaveLength(0);
    const alertFailureRow = deps.logSheet.rows.find(
      (row) => row[1] === 'ERROR' && String(row[3]).includes('Failed to send watchdog error alert'),
    );
    expect(alertFailureRow).toBeDefined();
    // The failure count itself is still persisted even though sending the alert about it blew up.
    expect(deps.configStore.loadAll()[0]).toMatchObject({ consecutiveFailureCount: 2 });
  });
});
