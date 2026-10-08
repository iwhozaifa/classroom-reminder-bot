import { resolveDueInstant } from './time.js';
import { isPending } from './rules/pendingState.js';
import { desiredDueDateReminders } from './rules/dueDateRules.js';
import { desiredNoDueDateReminders } from './rules/noDueDateRules.js';
import type { Assignment, Instant, Reminder, ReminderChange, UserConfig } from './types.js';

export interface ReconcileInput {
  now: Instant;
  config: UserConfig;
  liveAssignments: Assignment[];
  storedReminders: Reminder[];
}

export interface ReconcileResult {
  /** Handed straight to planDeliveries() — the full channel-agnostic desired state. */
  desiredReminders: Reminder[];
  changes: ReminderChange[];
}

/**
 * Computes which Reminders should exist right now and diffs them against stored
 * state. Pure — no I/O — which is what makes idempotency provable in tests: run
 * this twice with run 1's output fed back as run 2's `storedReminders` and `changes`
 * must be empty.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const { now, config, liveAssignments, storedReminders } = input;
  const desiredReminders: Reminder[] = [];

  for (const assignment of liveAssignments) {
    const dueAt = resolveDueInstant(assignment.dueDate, assignment.dueTime, config.timezone);
    if (!isPending(assignment, dueAt, now)) continue;

    const base = {
      userId: config.userId,
      assignmentId: assignment.assignmentId,
      courseId: assignment.courseId,
      title: assignment.title,
      dueAt,
      submissionStateSnapshot: assignment.submissionState,
    };

    const offsets =
      dueAt !== null
        ? desiredDueDateReminders(dueAt, now)
        : desiredNoDueDateReminders(assignment.postedAt, now, config.rollingWindowDays);

    for (const offset of offsets) {
      desiredReminders.push({ ...base, reminderType: offset.reminderType, fireAt: offset.fireAt });
    }
  }

  return { desiredReminders, changes: diffReminders(desiredReminders, storedReminders) };
}

/**
 * `fireAt` is part of the key on purpose: when a due-date change moves an offset's
 * fire time, the old (assignmentId, reminderType, oldFireAt) key simply stops being
 * desired (→ remove) while the new one appears fresh (→ create) — rule 6's
 * cancel-and-recreate falls out of the diff for free, no special "update" case needed.
 */
function reminderKey(r: Pick<Reminder, 'assignmentId' | 'reminderType' | 'fireAt'>): string {
  return `${r.assignmentId}:${r.reminderType}:${r.fireAt}`;
}

function diffReminders(desired: Reminder[], stored: Reminder[]): ReminderChange[] {
  const changes: ReminderChange[] = [];
  const desiredByKey = new Map(desired.map((r) => [reminderKey(r), r]));
  const storedByKey = new Map(stored.map((r) => [reminderKey(r), r]));

  for (const [key, reminder] of desiredByKey) {
    if (!storedByKey.has(key)) changes.push({ kind: 'create', reminder });
  }
  for (const [key, reminder] of storedByKey) {
    if (!desiredByKey.has(key)) changes.push({ kind: 'remove', reminder });
  }
  return changes;
}
