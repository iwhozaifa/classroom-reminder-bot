import { describe, expect, it } from 'vitest';
import { desiredDueDateReminders } from '../../src/core/rules/dueDateRules.js';
import { MS_PER_HOUR } from '../../src/core/time.js';

describe('desiredDueDateReminders', () => {
  it('produces all four offsets when now is well before the earliest one', () => {
    const dueAt = Date.UTC(2026, 0, 20, 23, 59);
    const now = dueAt - 30 * MS_PER_HOUR;
    expect(desiredDueDateReminders(dueAt, now)).toEqual([
      { reminderType: '24h', fireAt: dueAt - 24 * MS_PER_HOUR },
      { reminderType: '12h', fireAt: dueAt - 12 * MS_PER_HOUR },
      { reminderType: '2h', fireAt: dueAt - 2 * MS_PER_HOUR },
      { reminderType: '1h', fireAt: dueAt - 1 * MS_PER_HOUR },
    ]);
  });

  it('omits an offset whose moment has already passed, never retroactively creating it', () => {
    const dueAt = Date.UTC(2026, 0, 20, 23, 59);
    const now = dueAt - 5 * MS_PER_HOUR; // already past the 24h and 12h marks
    const result = desiredDueDateReminders(dueAt, now);
    expect(result.map((r) => r.reminderType)).toEqual(['2h', '1h']);
  });

  it('omits every offset once a due-date change has left all of them in the past', () => {
    // reconcile() only ever calls this with the CURRENT due date — there's no "old" offset to
    // retroactively create once the due date has moved; the function simply has nothing to return.
    const newDueAt = Date.UTC(2026, 0, 16, 10, 0);
    const now = Date.UTC(2026, 0, 16, 9, 30); // 30 min before the new due date
    expect(desiredDueDateReminders(newDueAt, now)).toEqual([]);
  });

  it('handles a midnight UTC boundary without an off-by-one', () => {
    const dueAt = Date.UTC(2026, 2, 1, 0, 0); // 2026-03-01T00:00:00Z
    const now = dueAt - 25 * MS_PER_HOUR;
    const result = desiredDueDateReminders(dueAt, now);
    expect(result.find((r) => r.reminderType === '24h')!.fireAt).toBe(Date.UTC(2026, 1, 28, 0, 0));
  });

  it('returns nothing once every offset is in the past', () => {
    const dueAt = Date.UTC(2026, 0, 20, 23, 59);
    expect(desiredDueDateReminders(dueAt, dueAt)).toEqual([]);
  });
});
