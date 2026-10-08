import { describe, expect, it } from 'vitest';
import {
  deliveryToRow,
  reminderToRow,
  rowToDelivery,
  rowToReminder,
} from '../../../src/adapters/sheets/rowMapping.js';
import type { Delivery, Reminder } from '../../../src/core/types.js';

const reminder: Reminder = {
  userId: 'u1',
  assignmentId: 'a1',
  courseId: 'c1',
  title: 'HW 1',
  reminderType: '24h',
  dueAt: Date.UTC(2026, 0, 10, 12, 0),
  fireAt: Date.UTC(2026, 0, 9, 12, 0),
  submissionStateSnapshot: 'NEW',
};

const delivery: Delivery = {
  userId: 'u1',
  assignmentId: 'a1',
  reminderType: '24h',
  fireAt: Date.UTC(2026, 0, 9, 12, 0),
  channel: 'slack',
  status: 'scheduled',
  externalMessageId: 'Q123',
};

describe('rowMapping — Reminders', () => {
  it('round-trips a reminder with a due date through row<->object unchanged', () => {
    const row = reminderToRow(reminder, 1000, 2000);
    expect(rowToReminder(row)).toEqual(reminder);
  });

  it.each(['24h', '12h', '2h', '1h', 'daily'] as const)(
    'round-trips every reminderType value: %s',
    (reminderType) => {
      const r: Reminder = { ...reminder, reminderType };
      expect(rowToReminder(reminderToRow(r, 1000, 2000))).toEqual(r);
    },
  );

  it('round-trips a null dueAt (no-due-date assignment) as a blank cell, not the string "null"', () => {
    const r: Reminder = { ...reminder, dueAt: null };
    const row = reminderToRow(r, 1000, 2000);
    expect(row[5]).toBe('');
    expect(rowToReminder(row)).toEqual(r);
  });

  it('tolerates a null cell (not just empty string) for dueAt, since real Sheets can return either', () => {
    const row = reminderToRow(reminder, 1000, 2000);
    row[5] = null;
    expect(rowToReminder(row).dueAt).toBeNull();
  });
});

describe('rowMapping — Deliveries', () => {
  it('round-trips a scheduled delivery with an external message id unchanged', () => {
    const row = deliveryToRow(delivery, 500, 2000);
    expect(rowToDelivery(row)).toEqual(delivery);
  });

  it.each(['pending', 'scheduled', 'sent', 'cancelled', 'failed'] as const)(
    'round-trips every status value: %s',
    (status) => {
      const d: Delivery = { ...delivery, status };
      expect(rowToDelivery(deliveryToRow(d, 500, 2000))).toEqual(d);
    },
  );

  it('round-trips a null externalMessageId (non-scheduling channel) as a blank cell', () => {
    const d: Delivery = { ...delivery, externalMessageId: null };
    const row = deliveryToRow(d, null, 2000);
    expect(row[6]).toBe('');
    expect(row[7]).toBe('');
    expect(rowToDelivery(row)).toEqual(d);
  });

  it('tolerates a null cell for externalMessageId, since real Sheets can return either', () => {
    const row = deliveryToRow(delivery, 500, 2000);
    row[6] = null;
    expect(rowToDelivery(row).externalMessageId).toBeNull();
  });
});
