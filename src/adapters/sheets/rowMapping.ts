// Pure array<->object mapping, tested directly with Vitest (no SpreadsheetApp
// involved) — see CLAUDE.md / the M4 plan note on keeping the Sheet-touching seam
// thin and testing this part of it as plain functions instead.
import type { Delivery, DeliveryStatus, Instant, Reminder, ReminderType, SubmissionState } from '../../core/types.js';

/** Matches reconcile.ts's private reminderKey — fireAt is part of it on purpose. */
export function reminderKey(r: Pick<Reminder, 'assignmentId' | 'reminderType' | 'fireAt'>): string {
  return `${r.assignmentId}:${r.reminderType}:${r.fireAt}`;
}

/** Matches planDeliveries.ts's private deliveryKey. */
export function deliveryKey(d: Pick<Delivery, 'assignmentId' | 'reminderType' | 'fireAt' | 'channel'>): string {
  return `${d.assignmentId}:${d.reminderType}:${d.fireAt}:${d.channel}`;
}

/** Column order mirrors schema.ts's REMINDERS_HEADERS exactly. */
export function reminderToRow(reminder: Reminder, createdAt: Instant, lastSynced: Instant): unknown[] {
  return [
    reminder.userId,
    reminder.assignmentId,
    reminder.courseId,
    reminder.title,
    reminder.reminderType,
    reminder.dueAt ?? '',
    reminder.fireAt,
    reminder.submissionStateSnapshot,
    createdAt,
    lastSynced,
  ];
}

/**
 * created_at/last_synced aren't part of the core Reminder type (they're Sheet-only
 * bookkeeping), so they're simply not read back here — the Store keeps the raw row
 * around separately when it needs to preserve them across a rewrite.
 */
export function rowToReminder(row: unknown[]): Reminder {
  return {
    userId: String(row[0]),
    assignmentId: String(row[1]),
    courseId: String(row[2]),
    title: String(row[3]),
    reminderType: row[4] as ReminderType,
    dueAt: parseNullableInstant(row[5]),
    fireAt: Number(row[6]),
    submissionStateSnapshot: row[7] as SubmissionState,
  };
}

/** Column order mirrors schema.ts's DELIVERIES_HEADERS exactly. */
export function deliveryToRow(delivery: Delivery, lastAttemptAt: Instant | null, lastSynced: Instant): unknown[] {
  return [
    delivery.userId,
    delivery.assignmentId,
    delivery.reminderType,
    delivery.channel,
    delivery.status,
    delivery.fireAt,
    delivery.externalMessageId ?? '',
    lastAttemptAt ?? '',
    lastSynced,
  ];
}

export function rowToDelivery(row: unknown[]): Delivery {
  return {
    userId: String(row[0]),
    assignmentId: String(row[1]),
    reminderType: row[2] as ReminderType,
    channel: String(row[3]),
    status: row[4] as DeliveryStatus,
    fireAt: Number(row[5]),
    externalMessageId: row[6] === '' || row[6] === null || row[6] === undefined ? null : String(row[6]),
  };
}

/** A blank Sheet cell comes back as '' (sometimes null) from getValues(), never undefined. */
function parseNullableInstant(cell: unknown): Instant | null {
  if (cell === '' || cell === null || cell === undefined) return null;
  return Number(cell);
}
