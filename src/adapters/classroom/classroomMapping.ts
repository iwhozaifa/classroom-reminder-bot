// Pure mapping between Classroom's raw REST JSON shapes and core's Assignment type.
// Kept free of HTTP/pagination so it can be unit-tested without a fake network seam
// — same split as src/adapters/sheets/rowMapping.ts.

import type { Assignment, DueDateParts, DueTimeParts, SubmissionState } from '../../core/types.js';

/** Mirrors the subset of Classroom's CourseWork resource this bot needs. */
export interface RawCourseWork {
  id: string;
  title: string;
  state: string; // 'PUBLISHED' | 'DRAFT' | 'DELETED'
  creationTime: string; // RFC3339 UTC, e.g. '2026-01-05T09:00:00.000Z'
  dueDate?: DueDateParts;
  dueTime?: { hours?: number; minutes?: number };
}

/** Mirrors the subset of Classroom's StudentSubmission resource this bot needs. */
export interface RawStudentSubmission {
  courseWorkId: string;
  state: string;
}

const KNOWN_SUBMISSION_STATES: ReadonlySet<SubmissionState> = new Set([
  'NEW',
  'CREATED',
  'TURNED_IN',
  'RECLAIMED_BY_STUDENT',
  'RETURNED',
]);

/** Returns null for anything Classroom might send that we don't model — caller logs + skips. */
export function mapSubmissionState(raw: string | undefined): SubmissionState | null {
  if (raw !== undefined && KNOWN_SUBMISSION_STATES.has(raw as SubmissionState)) {
    return raw as SubmissionState;
  }
  return null;
}

function mapDueTime(raw: RawCourseWork['dueTime']): DueTimeParts | null {
  if (raw === undefined) return null;
  return { hours: raw.hours ?? 0, minutes: raw.minutes ?? 0 };
}

export function mapCourseWorkToAssignment(
  courseId: string,
  courseWork: RawCourseWork,
  submissionState: SubmissionState,
): Assignment {
  return {
    courseId,
    assignmentId: courseWork.id,
    title: courseWork.title,
    submissionState,
    postedAt: Date.parse(courseWork.creationTime),
    dueDate: courseWork.dueDate ?? null,
    dueTime: mapDueTime(courseWork.dueTime),
  };
}
