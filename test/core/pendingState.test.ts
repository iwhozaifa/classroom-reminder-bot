import { describe, expect, it } from 'vitest';
import { isPending } from '../../src/core/rules/pendingState.js';
import type { Assignment, Instant, SubmissionState } from '../../src/core/types.js';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const FUTURE = NOW + 3_600_000;
const PAST = NOW - 3_600_000;

function assignment(submissionState: SubmissionState): Assignment {
  return {
    courseId: 'course-1',
    assignmentId: 'assignment-1',
    title: 'Test assignment',
    submissionState,
    postedAt: PAST,
    dueDate: null,
    dueTime: null,
  };
}

describe('isPending', () => {
  it.each<[SubmissionState, Instant | null, boolean]>([
    ['NEW', null, true],
    ['NEW', FUTURE, true],
    ['NEW', PAST, true],
    ['CREATED', null, true],
    ['RECLAIMED_BY_STUDENT', null, true],
    ['TURNED_IN', null, false],
    ['TURNED_IN', FUTURE, false],
    ['RETURNED', FUTURE, true],
    ['RETURNED', PAST, false],
    ['RETURNED', null, false],
  ])('submissionState=%s dueAt=%s -> pending=%s', (submissionState, dueAt, expected) => {
    expect(isPending(assignment(submissionState), dueAt, NOW)).toBe(expected);
  });
});
