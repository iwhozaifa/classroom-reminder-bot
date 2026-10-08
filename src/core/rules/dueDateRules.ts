import { MS_PER_HOUR } from '../time.js';
import type { Instant, ReminderType } from '../types.js';

const OFFSET_HOURS: ReadonlyArray<{ reminderType: ReminderType; hours: number }> = [
  { reminderType: '24h', hours: 24 },
  { reminderType: '12h', hours: 12 },
  { reminderType: '2h', hours: 2 },
  { reminderType: '1h', hours: 1 },
];

export interface DesiredOffsetReminder {
  reminderType: ReminderType;
  fireAt: Instant;
}

/**
 * Rules 3 & 4: 24h/12h/2h/1h before the (already-resolved) due instant. An offset
 * whose moment has already passed is simply omitted — never retroactively created,
 * whether because the assignment was posted close to its due date or because the
 * due date just changed (rule 6). A stored reminder that *was* created in time but
 * missed its fire time because sync was late is handled separately, at the
 * Delivery layer (see catchUp.ts) — reconcile() never creates a past reminder.
 */
export function desiredDueDateReminders(dueAt: Instant, now: Instant): DesiredOffsetReminder[] {
  return OFFSET_HOURS.map(({ reminderType, hours }) => ({
    reminderType,
    fireAt: dueAt - hours * MS_PER_HOUR,
  })).filter((reminder) => reminder.fireAt > now);
}
