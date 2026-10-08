import type { Assignment, Instant } from '../types.js';

/**
 * Rules 1 & 2: NEW/CREATED/RECLAIMED_BY_STUDENT are always pending; TURNED_IN never
 * is; RETURNED is pending only if there's still a future due date — no due date (or
 * a due date already in the past) means a RETURNED assignment is done, not pending.
 */
export function isPending(assignment: Assignment, dueAt: Instant | null, now: Instant): boolean {
  switch (assignment.submissionState) {
    case 'TURNED_IN':
      return false;
    case 'NEW':
    case 'CREATED':
    case 'RECLAIMED_BY_STUDENT':
      return true;
    case 'RETURNED':
      return dueAt !== null && dueAt > now;
  }
}
