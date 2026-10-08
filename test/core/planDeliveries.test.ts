import { describe, expect, it } from 'vitest';
import { planDeliveries } from '../../src/core/planDeliveries.js';
import type { ChannelCapabilities, Delivery, Reminder } from '../../src/core/types.js';

const NOW = Date.UTC(2026, 0, 15, 12, 0);

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    userId: 'u1',
    assignmentId: 'a1',
    courseId: 'c1',
    title: 'HW 1',
    reminderType: '24h',
    dueAt: NOW + 48 * 3_600_000,
    fireAt: NOW + 24 * 3_600_000,
    submissionStateSnapshot: 'NEW',
    ...overrides,
  };
}

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    userId: 'u1',
    assignmentId: 'a1',
    reminderType: '24h',
    fireAt: NOW + 24 * 3_600_000,
    channel: 'slack',
    status: 'pending',
    externalMessageId: null,
    ...overrides,
  };
}

const schedulingCaps: Record<string, ChannelCapabilities> = { slack: { supportsScheduling: true } };
const nonSchedulingCaps: Record<string, ChannelCapabilities> = { whatsapp: { supportsScheduling: false } };

describe('planDeliveries — scheduling channel (Slack-shaped)', () => {
  it('schedules a brand-new desired delivery', () => {
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder()],
      storedDeliveries: [],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([{ kind: 'scheduleCreate', delivery: delivery() }]);
    expect(result.changes).toEqual([]);
  });

  it('is idempotent: once scheduled and stored, a second run with identical input produces nothing', () => {
    const scheduled = delivery({ status: 'scheduled', externalMessageId: 'slack-msg-1' });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder()],
      storedDeliveries: [scheduled],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('cancels a scheduled delivery whose reminder is no longer desired (e.g. turned in)', () => {
    const scheduled = delivery({ status: 'scheduled', externalMessageId: 'slack-msg-1' });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [],
      storedDeliveries: [scheduled],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([{ kind: 'scheduleCancel', delivery: scheduled }]);
    expect(result.changes).toEqual([{ kind: 'cancel', delivery: scheduled }]);
  });

  it.each(['sent', 'cancelled', 'failed'] as const)(
    'leaves an already-terminal (%s) delivery alone when it is no longer desired',
    (status) => {
      const terminal = delivery({ status });
      const result = planDeliveries({
        now: NOW,
        desiredReminders: [],
        storedDeliveries: [terminal],
        activeChannels: ['slack'],
        channelCapabilities: schedulingCaps,
      });
      expect(result.notifierActions).toEqual([]);
      expect(result.changes).toEqual([]);
    },
  );

  it('replaces (cancel old handle + create new) when the same reminder now fires at a different time', () => {
    const oldScheduled = delivery({ status: 'scheduled', externalMessageId: 'slack-msg-1' });
    const moved = reminder({ fireAt: NOW + 30 * 3_600_000 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [moved],
      storedDeliveries: [oldScheduled],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toContainEqual({ kind: 'scheduleCancel', delivery: oldScheduled });
    expect(result.notifierActions).toContainEqual({
      kind: 'scheduleCreate',
      delivery: delivery({ fireAt: NOW + 30 * 3_600_000 }),
    });
    expect(result.changes).toEqual([{ kind: 'cancel', delivery: oldScheduled }]);
  });

  it('never dispatches a successfully scheduled delivery itself, even once its fire time has passed', () => {
    // Slack owns delivery once scheduling succeeded — Apps Script must never also send it.
    const scheduled = delivery({ status: 'scheduled', externalMessageId: 'slack-msg-1', fireAt: NOW - 1000 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder({ fireAt: NOW - 1000 })],
      storedDeliveries: [scheduled],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('falls back to dispatchSendNow (catch-up) when a schedule attempt never succeeded and the fire time passed', () => {
    const neverScheduled = delivery({ status: 'pending', fireAt: NOW - 1000 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder({ fireAt: NOW - 1000 })],
      storedDeliveries: [neverScheduled],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([{ kind: 'dispatchSendNow', delivery: neverScheduled }]);
  });

  it('among several missed deliveries for the same assignment, dispatches only the most urgent and cancels the rest', () => {
    const d24 = delivery({ reminderType: '24h', fireAt: NOW - 10_000, status: 'pending' });
    const d12 = delivery({ reminderType: '12h', fireAt: NOW - 5_000, status: 'pending' });
    const d1 = delivery({ reminderType: '1h', fireAt: NOW - 1_000, status: 'pending' });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [
        reminder({ reminderType: '24h', fireAt: NOW - 10_000 }),
        reminder({ reminderType: '12h', fireAt: NOW - 5_000 }),
        reminder({ reminderType: '1h', fireAt: NOW - 1_000 }),
      ],
      storedDeliveries: [d24, d12, d1],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(result.notifierActions).toEqual([{ kind: 'dispatchSendNow', delivery: d1 }]);
    expect(result.changes).toHaveLength(2);
    expect(result.changes).toContainEqual({ kind: 'cancel', delivery: d24 });
    expect(result.changes).toContainEqual({ kind: 'cancel', delivery: d12 });
  });
});

describe('planDeliveries — non-scheduling channel (the multi-channel proof)', () => {
  const whatsapp = (overrides: Partial<Delivery> = {}) => delivery({ channel: 'whatsapp', ...overrides });

  it('never emits a schedule* action for a non-scheduling channel — a brand-new delivery stays pending', () => {
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder()],
      storedDeliveries: [],
      activeChannels: ['whatsapp'],
      channelCapabilities: nonSchedulingCaps,
    });
    expect(result.notifierActions).toEqual([]);
    expect(result.changes).toEqual([{ kind: 'create', delivery: whatsapp() }]);
  });

  it('holds a pending delivery with no action while its fire time is still in the future', () => {
    const pending = whatsapp({ fireAt: NOW + 10_000 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder({ fireAt: NOW + 10_000 })],
      storedDeliveries: [pending],
      activeChannels: ['whatsapp'],
      channelCapabilities: nonSchedulingCaps,
    });
    expect(result.notifierActions).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('dispatches via sendNow the instant fireAt <= now — this is its only delivery path, every cycle', () => {
    const pending = whatsapp({ fireAt: NOW - 1 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [reminder({ fireAt: NOW - 1 })],
      storedDeliveries: [pending],
      activeChannels: ['whatsapp'],
      channelCapabilities: nonSchedulingCaps,
    });
    expect(result.notifierActions).toEqual([{ kind: 'dispatchSendNow', delivery: pending }]);
    expect(result.changes).toEqual([]);
  });

  it('cancels a no-longer-desired pending delivery with no external call, since none exists to make', () => {
    const pending = whatsapp({ fireAt: NOW + 10_000 });
    const result = planDeliveries({
      now: NOW,
      desiredReminders: [],
      storedDeliveries: [pending],
      activeChannels: ['whatsapp'],
      channelCapabilities: nonSchedulingCaps,
    });
    expect(result.notifierActions).toEqual([]);
    expect(result.changes).toEqual([{ kind: 'cancel', delivery: pending }]);
  });

  it('is the exact same function as the scheduling-channel path — only the capabilities flag differs', () => {
    const lateReminder = reminder({ fireAt: NOW - 1 });

    const schedulingResult = planDeliveries({
      now: NOW,
      desiredReminders: [lateReminder],
      storedDeliveries: [],
      activeChannels: ['slack'],
      channelCapabilities: schedulingCaps,
    });
    expect(schedulingResult.notifierActions).toEqual([
      { kind: 'scheduleCreate', delivery: delivery({ fireAt: NOW - 1 }) },
    ]);

    const nonSchedulingResult = planDeliveries({
      now: NOW,
      desiredReminders: [lateReminder],
      storedDeliveries: [],
      activeChannels: ['whatsapp'],
      channelCapabilities: nonSchedulingCaps,
    });
    // Brand new — nothing stored yet to catch up on this cycle; it's created 'pending' and will
    // dispatch on the very next cycle once the stored row itself is seen with fireAt <= now.
    expect(nonSchedulingResult.notifierActions).toEqual([]);
    expect(nonSchedulingResult.changes).toEqual([{ kind: 'create', delivery: whatsapp({ fireAt: NOW - 1 }) }]);
  });
});
