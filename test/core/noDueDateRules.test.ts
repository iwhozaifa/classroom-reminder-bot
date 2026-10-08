import { describe, expect, it } from 'vitest';
import { desiredNoDueDateReminders } from '../../src/core/rules/noDueDateRules.js';
import { MS_PER_DAY, MS_PER_HOUR } from '../../src/core/time.js';

describe('desiredNoDueDateReminders', () => {
  it('schedules the first reminder exactly 12h after posting', () => {
    const postedAt = Date.UTC(2026, 0, 1, 0, 0);
    const result = desiredNoDueDateReminders(postedAt, postedAt, 7);
    expect(result[0]).toEqual({ reminderType: 'daily', fireAt: postedAt + 12 * MS_PER_HOUR });
  });

  it('recurs every 24h after the first reminder', () => {
    const postedAt = Date.UTC(2026, 0, 1, 0, 0);
    const result = desiredNoDueDateReminders(postedAt, postedAt, 7);
    const fireAts = result.map((r) => r.fireAt);
    for (let i = 1; i < fireAts.length; i++) {
      expect(fireAts[i]! - fireAts[i - 1]!).toBe(MS_PER_DAY);
    }
  });

  it('never schedules beyond now + rollingWindowDays', () => {
    const postedAt = Date.UTC(2026, 0, 1, 0, 0);
    const rollingWindowDays = 7;
    const result = desiredNoDueDateReminders(postedAt, postedAt, rollingWindowDays);
    const windowEnd = postedAt + rollingWindowDays * MS_PER_DAY;
    for (const r of result) {
      expect(r.fireAt).toBeLessThanOrEqual(windowEnd);
    }
  });

  it('tops up further reminders as now advances, sliding the window forward', () => {
    const postedAt = Date.UTC(2026, 0, 1, 0, 0);
    const rollingWindowDays = 7;
    const firstCycle = desiredNoDueDateReminders(postedAt, postedAt, rollingWindowDays);
    const later = postedAt + 3 * MS_PER_DAY;
    const secondCycle = desiredNoDueDateReminders(postedAt, later, rollingWindowDays);
    expect(secondCycle.every((r) => r.fireAt > later)).toBe(true);
    expect(Math.max(...secondCycle.map((r) => r.fireAt))).toBeGreaterThan(
      Math.max(...firstCycle.map((r) => r.fireAt)),
    );
  });

  it('returns nothing when even the first 12h offset falls outside the window', () => {
    const postedAt = Date.UTC(2026, 0, 1, 0, 0);
    expect(desiredNoDueDateReminders(postedAt, postedAt, 0)).toEqual([]);
  });
});
