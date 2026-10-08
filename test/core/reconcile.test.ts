import { describe, expect, it } from 'vitest';
import { reconcile } from '../../src/core/reconcile.js';
import { MS_PER_DAY } from '../../src/core/time.js';
import type { Assignment, Reminder, UserConfig } from '../../src/core/types.js';

const config: UserConfig = { userId: 'u1', timezone: 'Asia/Karachi', rollingWindowDays: 7 };

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    courseId: 'c1',
    assignmentId: 'a1',
    title: 'HW 1',
    submissionState: 'NEW',
    postedAt: Date.UTC(2026, 0, 1, 0, 0),
    dueDate: { year: 2026, month: 1, day: 10 },
    dueTime: { hours: 12, minutes: 0 },
    ...overrides,
  };
}

describe('reconcile', () => {
  it('creates all four due-date reminders for a fresh pending assignment', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const result = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: [] });
    expect(result.changes).toHaveLength(4);
    expect(result.changes.every((c) => c.kind === 'create')).toBe(true);
  });

  it('is idempotent: a second run fed its own prior output produces zero changes', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored: Reminder[] = first.changes.map((c) => c.reminder);
    const second = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: stored });
    expect(second.changes).toEqual([]);
  });

  it('cancels every stored reminder once the assignment is turned in', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const second = reconcile({
      now,
      config,
      liveAssignments: [assignment({ submissionState: 'TURNED_IN' })],
      storedReminders: stored,
    });
    expect(second.changes).toHaveLength(stored.length);
    expect(second.changes.every((c) => c.kind === 'remove')).toBe(true);
  });

  it('cancels every stored reminder once the assignment disappears entirely (deleted)', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const second = reconcile({ now, config, liveAssignments: [], storedReminders: stored });
    expect(second.changes).toHaveLength(stored.length);
    expect(second.changes.every((c) => c.kind === 'remove')).toBe(true);
  });

  it('replaces every offset (cancel old + create new) when the due date changes', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const moved = assignment({ dueDate: { year: 2026, month: 1, day: 20 } });
    const second = reconcile({ now, config, liveAssignments: [moved], storedReminders: stored });
    expect(second.changes.filter((c) => c.kind === 'remove')).toHaveLength(4);
    expect(second.changes.filter((c) => c.kind === 'create')).toHaveLength(4);
  });

  it('for a no-due-date assignment, tops up daily reminders within the rolling window from now', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0);
    const a = assignment({ dueDate: null, dueTime: null, postedAt: now - 365 * MS_PER_DAY });
    const result = reconcile({ now, config, liveAssignments: [a], storedReminders: [] });
    expect(result.changes.length).toBeGreaterThan(0);
    expect(
      result.changes.every((c) => c.reminder.fireAt > now && c.reminder.fireAt <= now + 7 * MS_PER_DAY),
    ).toBe(true);
  });

  it('never creates a reminder for a non-pending assignment in the first place', () => {
    const now = Date.UTC(2025, 11, 1, 0, 0);
    const result = reconcile({
      now,
      config,
      liveAssignments: [assignment({ submissionState: 'TURNED_IN' })],
      storedReminders: [],
    });
    expect(result.changes).toEqual([]);
  });

  it('retains an already-created reminder for a grace period after its own fireAt passes, unchanged', () => {
    // Without this, planDeliveries() could never see the matching stale Delivery as
    // still "desired" on the very next cycle — catch-up (rule 7) would be unreachable.
    const created = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now: created, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const staleOne = stored.find((r) => r.reminderType === '24h')!;

    const later = staleOne.fireAt + 60_000; // just past that one offset's fireAt, due date still future
    const second = reconcile({ now: later, config, liveAssignments: [assignment()], storedReminders: stored });

    expect(second.desiredReminders).toContainEqual(staleOne);
    expect(second.changes).toEqual([]);
  });

  it('finally lets a stale reminder expire once the retention grace period elapses', () => {
    const created = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now: created, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const staleOne = stored.find((r) => r.reminderType === '24h')!;

    const muchLater = staleOne.fireAt + 25 * MS_PER_DAY; // well past the 24h retention grace window
    const result = reconcile({ now: muchLater, config, liveAssignments: [assignment()], storedReminders: stored });

    expect(result.desiredReminders).not.toContainEqual(staleOne);
    expect(result.changes).toContainEqual({ kind: 'remove', reminder: staleOne });
  });

  it('retains a stale reminder for the right assignment only, when multiple assignments are live at once', () => {
    const created = Date.UTC(2025, 11, 1, 0, 0);
    const other = assignment({ assignmentId: 'a2', dueDate: { year: 2026, month: 2, day: 1 } });
    const first = reconcile({ now: created, config, liveAssignments: [assignment(), other], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const staleA1 = stored.find((r) => r.assignmentId === 'a1' && r.reminderType === '24h')!;

    const later = staleA1.fireAt + 60_000;
    const result = reconcile({ now: later, config, liveAssignments: [assignment(), other], storedReminders: stored });

    expect(result.desiredReminders).toContainEqual(staleA1);
    expect(result.desiredReminders.filter((r) => r.assignmentId === 'a2')).toHaveLength(4);
    expect(result.changes).toEqual([]);
  });

  it('does not retain a stale reminder whose due date has since changed — it is replaced, not kept', () => {
    const created = Date.UTC(2025, 11, 1, 0, 0);
    const first = reconcile({ now: created, config, liveAssignments: [assignment()], storedReminders: [] });
    const stored = first.changes.map((c) => c.reminder);
    const staleOne = stored.find((r) => r.reminderType === '24h')!;

    const later = staleOne.fireAt + 60_000;
    const moved = assignment({ dueDate: { year: 2026, month: 1, day: 20 } });
    const result = reconcile({ now: later, config, liveAssignments: [moved], storedReminders: stored });

    expect(result.desiredReminders).not.toContainEqual(staleOne);
    expect(result.changes).toContainEqual({ kind: 'remove', reminder: staleOne });
  });
});
