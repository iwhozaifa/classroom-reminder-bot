import { describe, expect, it } from 'vitest';
import { SheetLogger } from '../../src/adapters/sheets/SheetLogger.js';
import type { ScheduledSlackMessage } from '../../src/adapters/slack/SlackNotifier.js';
import type { Delivery } from '../../src/core/types.js';
import { runPurgeOrphanScheduled } from '../../src/triggers/purgeOrphanScheduled.js';
import { FakeLock } from '../fakes/FakeLock.js';
import { FakeSheet } from '../fakes/FakeSheet.js';
import { FixedClock } from '../fakes/FixedClock.js';
import { InMemoryDeliveryStore } from '../fakes/InMemoryDeliveryStore.js';

class FakeQueue {
  readonly deleted: string[] = [];
  constructor(private readonly messages: ScheduledSlackMessage[]) {}
  listScheduled(): ScheduledSlackMessage[] {
    return this.messages;
  }
  cancel(id: string): void {
    this.deleted.push(id);
  }
}

function delivery(overrides: Partial<Delivery>): Delivery {
  return {
    userId: 'u1',
    assignmentId: 'a1',
    reminderType: '24h',
    fireAt: 1_000,
    channel: 'slack',
    status: 'scheduled',
    externalMessageId: 'Q1',
    ...overrides,
  };
}

function setup(lock = new FakeLock()) {
  const logSheet = new FakeSheet('Log');
  const logger = new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, new FixedClock(0));
  const deliveryStore = new InMemoryDeliveryStore();
  deliveryStore.applyChanges([
    { kind: 'create', delivery: delivery({ externalMessageId: 'Q1' }) },
    { kind: 'create', delivery: delivery({ reminderType: '12h', externalMessageId: 'Q2', status: 'sent' }) },
    { kind: 'create', delivery: delivery({ userId: 'u2', assignmentId: 'a2', externalMessageId: 'Q3' }) },
  ]);
  const queue = new FakeQueue([
    { id: 'Q1', postAt: 1 },
    { id: 'Q2', postAt: 2 },
    { id: 'Q3', postAt: 3 },
    { id: 'Q-dup', postAt: 4 },
  ]);
  const deps = {
    lock,
    logger,
    configStore: { loadAll: () => [{ userId: 'u1' }, { userId: 'u2' }] },
    deliveryStore,
    queue,
  };
  return { deps, queue, logSheet, lock };
}

describe('runPurgeOrphanScheduled', () => {
  it("deletes every queued message no 'scheduled' Deliveries row owns, across all users, and keeps the rest", () => {
    const { deps, queue, logSheet, lock } = setup();

    const deleted = runPurgeOrphanScheduled(deps);

    // Q2's row is 'sent', so a queued Q2 is not owned; Q-dup has no row at all.
    expect(queue.deleted).toEqual(['Q2', 'Q-dup']);
    expect(deleted).toBe(2);
    expect(logSheet.rows.some((row) => row[1] === 'INFO' && row[2] === 'purge')).toBe(true);
    expect(lock.released).toBe(true);
  });

  it('does nothing and returns null when a sync holds the lock', () => {
    const { deps, queue } = setup(new FakeLock(false));

    expect(runPurgeOrphanScheduled(deps)).toBeNull();
    expect(queue.deleted).toEqual([]);
  });
});
