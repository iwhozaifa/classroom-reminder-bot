import { beforeEach, describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '../../src/core/time.js';
import type { Assignment, UserConfig } from '../../src/core/types.js';
import { FakeClassroomSource } from '../fakes/FakeClassroomSource.js';
import { FakeSchedulingNotifier } from '../fakes/FakeSchedulingNotifier.js';
import { FixedClock } from '../fakes/FixedClock.js';
import { InMemoryDeliveryStore } from '../fakes/InMemoryDeliveryStore.js';
import { InMemoryReminderStore } from '../fakes/InMemoryReminderStore.js';
import { runSyncCycle } from '../../src/triggers/syncReminders.js';

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

describe('sync cycle — scheduling channel (Slack-shaped), end to end against fakes', () => {
  let source: FakeClassroomSource;
  let notifier: FakeSchedulingNotifier;
  let reminderStore: InMemoryReminderStore;
  let deliveryStore: InMemoryDeliveryStore;
  let clock: FixedClock;

  beforeEach(() => {
    source = new FakeClassroomSource();
    notifier = new FakeSchedulingNotifier();
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
      notifiers: { slack: notifier },
      activeChannels: ['slack'],
    });
  }

  it('posted -> scheduled: a fresh pending assignment produces 4 reminders, each scheduled with Slack', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();

    expect(reminderStore.loadReminders('u1')).toHaveLength(4);
    const deliveries = deliveryStore.loadDeliveries('u1');
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d) => d.status === 'scheduled' && d.externalMessageId !== null)).toBe(true);
    expect(notifier.scheduled.size).toBe(4);
  });

  it('is idempotent across repeated cycles with no input change — runs 2 and 3 do nothing new', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    const scheduledAfterFirst = notifier.scheduled.size;

    cycle();
    cycle();

    expect(notifier.scheduled.size).toBe(scheduledAfterFirst);
    expect(notifier.cancelled).toHaveLength(0);
    expect(notifier.sentNow).toHaveLength(0);
    expect(reminderStore.loadReminders('u1')).toHaveLength(4);
    expect(deliveryStore.loadDeliveries('u1')).toHaveLength(4);
  });

  it('due date changed -> reschedule: old scheduled handles are cancelled and replaced (no in-place reschedule)', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    const firstIds = [...notifier.scheduled.keys()];

    source.setAssignments('c1', [assignment({ dueDate: { year: 2026, month: 1, day: 20 } })]);
    cycle();

    expect(notifier.cancelled.slice().sort()).toEqual(firstIds.slice().sort());
    // Delivery rows persist with status rather than being deleted (matches the Sheet
    // schema), so the old cancelled rows and the new scheduled ones both remain.
    const deliveries = deliveryStore.loadDeliveries('u1');
    expect(deliveries).toHaveLength(8);
    const current = deliveries.filter((d) => d.status === 'scheduled');
    expect(current).toHaveLength(4);
    expect(current.every((d) => !firstIds.includes(d.externalMessageId!))).toBe(true);
    expect(deliveries.filter((d) => d.status === 'cancelled')).toHaveLength(4);
  });

  it('turned in -> every scheduled delivery is cancelled with Slack and the reminders disappear', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    expect(notifier.scheduled.size).toBe(4);

    source.setAssignments('c1', [assignment({ submissionState: 'TURNED_IN' })]);
    cycle();

    expect(notifier.scheduled.size).toBe(0);
    expect(notifier.cancelled).toHaveLength(4);
    expect(reminderStore.loadReminders('u1')).toHaveLength(0);
    expect(deliveryStore.loadDeliveries('u1').every((d) => d.status === 'cancelled')).toBe(true);
  });

  it('assignment deleted entirely -> every scheduled delivery is cancelled, same as turning it in', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();
    expect(notifier.scheduled.size).toBe(4);

    source.setAssignments('c1', []);
    cycle();

    expect(notifier.scheduled.size).toBe(0);
    expect(notifier.cancelled).toHaveLength(4);
    expect(reminderStore.loadReminders('u1')).toHaveLength(0);
  });

  it('catches up via sendNow when a schedule attempt failed and its fire time has since passed', () => {
    // A permanent Slack failure (e.g. time_in_past on a very-short-fuse assignment)
    // leaves the delivery 'failed' rather than 'scheduled' — simulated here by
    // swapping in a notifier whose schedule() always throws for this one cycle.
    const alwaysFails = new FakeSchedulingNotifier();
    alwaysFails.schedule = () => {
      throw new Error('simulated permanent Slack failure');
    };
    source.setAssignments('c1', [assignment()]);
    runSyncCycle({
      clock,
      config,
      courseIds: ['c1'],
      source,
      reminderStore,
      deliveryStore,
      notifiers: { slack: alwaysFails },
      activeChannels: ['slack'],
    });
    const failed = deliveryStore.loadDeliveries('u1').find((d) => d.reminderType === '24h')!;
    expect(failed.status).toBe('failed');

    // Advance just past that offset's fireAt (due date still comfortably in the future).
    clock.advanceTo(failed.fireAt + 60_000);
    cycle();

    expect(notifier.sentNow.map((d) => d.reminderType)).toContain('24h');
    const updated = deliveryStore.loadDeliveries('u1').find((d) => d.reminderType === '24h')!;
    expect(updated.status).toBe('sent');
  });

  it('never dispatches a successfully scheduled delivery itself, even once real time moves past its fire time', () => {
    source.setAssignments('c1', [assignment()]);
    cycle();

    clock.advanceTo(NOW + 5 * MS_PER_DAY); // past every offset's fireAt, due date still ahead (Jan 10)
    cycle();

    expect(notifier.sentNow).toHaveLength(0);
  });
});
