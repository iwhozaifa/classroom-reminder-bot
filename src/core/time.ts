import type { DueDateParts, DueTimeParts, Instant } from './types.js';

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Resolves an assignment's due date/time to a UTC instant.
 *
 * Classroom's dueDate/dueTime are already UTC (API reference), so when dueTime is
 * present this is plain arithmetic — no timezone involved. The one case that
 * genuinely needs `timezone` is a due date with no time at all: the product default
 * is 23:59 in the *user's* configured zone, not UTC, so that wall-clock moment has
 * to be converted to its correct UTC instant (DST-aware).
 */
export function resolveDueInstant(
  dueDate: DueDateParts | null,
  dueTime: DueTimeParts | null,
  timezone: string,
): Instant | null {
  if (dueDate === null) return null;
  if (dueTime !== null) {
    return Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day, dueTime.hours, dueTime.minutes);
  }
  return zonedWallClockToUtc(dueDate.year, dueDate.month - 1, dueDate.day, 23, 59, timezone);
}

/** Converts a wall-clock date/time *as read in `timeZone`* to its UTC instant. */
function zonedWallClockToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Instant {
  const guess = Date.UTC(year, monthIndex, day, hour, minute);
  const offset = tzOffsetMillisAt(guess, timeZone);
  return guess - offset;
}

/** How far `timeZone`'s wall clock is ahead of UTC at the given instant. */
function tzOffsetMillisAt(instant: Instant, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const shownAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return shownAsUtc - instant;
}
