import { describe, expect, it } from 'vitest';
import { mapCourseWorkToAssignment, mapSubmissionState } from '../../../src/adapters/classroom/classroomMapping.js';
import type { RawCourseWork } from '../../../src/adapters/classroom/classroomMapping.js';

describe('mapSubmissionState', () => {
  it.each(['NEW', 'CREATED', 'TURNED_IN', 'RECLAIMED_BY_STUDENT', 'RETURNED'])('accepts the known state %s', (state) => {
    expect(mapSubmissionState(state)).toBe(state);
  });

  it('returns null for an unrecognized state string', () => {
    expect(mapSubmissionState('SOME_FUTURE_STATE')).toBeNull();
  });

  it('returns null when no submission exists at all (undefined)', () => {
    expect(mapSubmissionState(undefined)).toBeNull();
  });
});

describe('mapCourseWorkToAssignment', () => {
  it('maps a courseWork item with an explicit due date and time', () => {
    const raw: RawCourseWork = {
      id: 'cw-1',
      title: 'Essay draft',
      state: 'PUBLISHED',
      creationTime: '2026-01-05T09:00:00.000Z',
      dueDate: { year: 2026, month: 1, day: 12 },
      dueTime: { hours: 23, minutes: 59 },
    };

    const assignment = mapCourseWorkToAssignment('course-1', raw, 'CREATED');

    expect(assignment).toEqual({
      courseId: 'course-1',
      assignmentId: 'cw-1',
      title: 'Essay draft',
      submissionState: 'CREATED',
      postedAt: Date.parse('2026-01-05T09:00:00.000Z'),
      dueDate: { year: 2026, month: 1, day: 12 },
      dueTime: { hours: 23, minutes: 59 },
    });
  });

  it('maps a courseWork item with no due date as dueDate: null, dueTime: null', () => {
    const raw: RawCourseWork = {
      id: 'cw-3',
      title: 'Reading reflection',
      state: 'PUBLISHED',
      creationTime: '2026-01-07T09:00:00.000Z',
    };

    const assignment = mapCourseWorkToAssignment('course-1', raw, 'NEW');

    expect(assignment.dueDate).toBeNull();
    expect(assignment.dueTime).toBeNull();
  });

  it('defaults missing dueTime.hours/minutes to 0 when dueDate is set but dueTime is partial', () => {
    const raw: RawCourseWork = {
      id: 'cw-4',
      title: 'Midnight due',
      state: 'PUBLISHED',
      creationTime: '2026-01-07T09:00:00.000Z',
      dueDate: { year: 2026, month: 1, day: 20 },
      dueTime: {},
    };

    const assignment = mapCourseWorkToAssignment('course-1', raw, 'NEW');

    expect(assignment.dueTime).toEqual({ hours: 0, minutes: 0 });
  });
});
