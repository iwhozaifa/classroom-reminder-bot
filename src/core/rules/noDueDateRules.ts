import { MS_PER_DAY, MS_PER_HOUR } from '../time.js';
import type { Instant } from '../types.js';

export interface DesiredDailyReminder {
  reminderType: 'daily';
  fireAt: Instant;
}

/**
 * Rule 5: for an assignment with no due date, the first reminder fires 12h after
 * posting, then every 24h after that. Nothing is ever scheduled beyond
 * `now + rollingWindowDays` — the window is anchored to *now*, not to postedAt, so
 * each sync "tops up" newly-in-range future reminders as now advances, rather than
 * front-loading the whole window at creation time.
 */
export function desiredNoDueDateReminders(
  postedAt: Instant,
  now: Instant,
  rollingWindowDays: number,
): DesiredDailyReminder[] {
  const windowEnd = now + rollingWindowDays * MS_PER_DAY;
  const reminders: DesiredDailyReminder[] = [];

  let fireAt = postedAt + 12 * MS_PER_HOUR;
  while (fireAt <= windowEnd) {
    if (fireAt > now) {
      reminders.push({ reminderType: 'daily', fireAt });
    }
    fireAt += MS_PER_DAY;
  }
  return reminders;
}
