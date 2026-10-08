import { beforeEach, describe, expect, it } from 'vitest';
import type { Assignment, UserConfig } from '../../src/core/types.js';
import { FakeClassroomSource } from '../fakes/FakeClassroomSource.js';
import { FakeNonSchedulingNotifier } from '../fakes/FakeNonSchedulingNotifier.js';
import { FixedClock } from '../fakes/FixedClock.js';
import { InMemoryDeliveryStore } from '../fakes/InMemoryDeliveryStore.js';
import { InMemoryReminderStore } from '../fakes/InMemoryReminderStore.js';
import { runSyncCycle } from './runSyncCycle.js';

const NOW = Date.UTC(2026, 0, 1, 0, 0);

const config: UserConfig = { userId: 'u1', timezone: 'Asia/Karachi', rollingWindowDays: 7 };

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    courseId: 'c1',
    assignmentId: 'a1',
    title: 'HW 1',
    submissionState: 'NEW',
    postedAt: NOW,
    dueDate: { year: 2026, month: 1, day: 10 },
    dueTime: { hours: 12, minutes: 0 },
    ...overrides,
  };
}

/**
 * The multi-channel proof, run for real: a non-scheduling channel (CallMeBot/WhatsApp
 * -shaped) driven through the exact same reconcile()+planDeliveries() pipeline as the
 * Slack suite, with zero code path differences — only `supportsScheduling: false` on
 * the notifier passed in. `FakeNonSchedulingNotifier.schedule`/`cancel` throw, so any
 * wiring bug that reached them would fail these tests loudly rather than silently.
 */
describe('sync cycle — non-scheduling channel (WhatsApp-shaped), end to end against fakes', () => {
  let source: FakeClassroomSource;
  let notifier: FakeNonSchedulingNotifier;
  let reminderStore: InMemoryReminderStore;
  let deliveryStore: InMemoryDeliveryStore;
  let clock: FixedClock;

  beforeEach(() => {
    source = new FakeClassroomSource();
    notifier = new FakeNonSchedulingNotifier();
    reminderStore = new InMemoryReminderStore();
    deliveryStore = new InMemoryDeliveryStore();
    clock = new FixedClock(NOW);
  });

  function cycle(): void {
    runSyncCycle({
      clock,
      config,
      courseIds: ['c1'],
      source,
      reminderStore,
      deliveryStore,
      notifiers: { whatsapp: notifier },
      activeChannels: ['whatsapp'],
    });
  }

  it('posted -> held pending: a fresh delivery is created as pending, no sendNow yet', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();

    const deliveries = deliveryStore.loadDeliveries('u1');
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d) => d.status === 'pending' && d.externalMessageId === null)).toBe(true);
    expect(notifier.sentNow).toHaveLength(0);
  });

  it('is idempotent across repeated cycles while every fire time is still in the future', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    cycle();
    cycle();

    expect(notifier.sentNow).toHaveLength(0);
    expect(deliveryStore.loadDeliveries('u1')).toHaveLength(4);
  });

  it('dispatches via sendNow the instant a fire time arrives — this is its only delivery path, every cycle', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    const pending24h = deliveryStore.loadDeliveries('u1').find((d) => d.reminderType === '24h')!;

    clock.advanceTo(pending24h.fireAt + 60_000);
    cycle();

    expect(notifier.sentNow.map((d) => d.reminderType)).toEqual(['24h']);
    const updated = deliveryStore.loadDeliveries('u1').find((d) => d.reminderType === '24h')!;
    expect(updated.status).toBe('sent');
    expect(updated.externalMessageId).toBeNull(); // CallMeBot has no message-id concept
  });

  it('dispatches only the most urgent of several simultaneously-overdue deliveries, each on its own cycle', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    const pending12h = deliveryStore.loadDeliveries('u1').find((d) => d.reminderType === '12h')!;

    // Jump straight past both the 24h and 12h offsets in one go.
    clock.advanceTo(pending12h.fireAt + 60_000);
    cycle();

    expect(notifier.sentNow).toHaveLength(1);
    expect(notifier.sentNow[0]!.reminderType).toBe('12h'); // most urgent (latest fireAt) wins
    const d24 = deliveryStore.loadDeliveries('u1').find((r) => r.reminderType === '24h')!;
    expect(d24.status).toBe('cancelled'); // the less-urgent backlog entry is dropped, not sent
  });

  it('cancels a no-longer-desired pending delivery with no external call, since none exists to make', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    expect(deliveryStore.loadDeliveries('u1')).toHaveLength(4);

    source.setAssignments('c1', [assignment({ submissionState: 'TURNED_IN' })]);
    cycle();

    expect(notifier.sentNow).toHaveLength(0);
    expect(deliveryStore.loadDeliveries('u1').every((d) => d.status === 'cancelled')).toBe(true);
  });
});
