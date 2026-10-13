import { describe, expect, it } from 'vitest';
import { planRegistrations } from '../../src/core/registrations.js';
import { MS_PER_DAY } from '../../src/core/time.js';
import type { Registration } from '../../src/core/types.js';

const NOW = Date.UTC(2026, 0, 1);
const RENEW_BEFORE = 2 * MS_PER_DAY;

function registration(
  courseId: string,
  expiresInDays: number,
  registrationId = `reg-${courseId}`,
): Registration {
  return { courseId, registrationId, expiresAt: NOW + expiresInDays * MS_PER_DAY };
}

describe('planRegistrations', () => {
  it('creates a registration for every followed course when none exist yet', () => {
    const plan = planRegistrations({
      courseIds: ['c1', 'c2'],
      stored: [],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [], create: ['c1', 'c2'], drop: [] });
  });

  it('keeps a registration that still has more than the renew window left', () => {
    const fresh = registration('c1', 5);

    const plan = planRegistrations({
      courseIds: ['c1'],
      stored: [fresh],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [fresh], create: [], drop: [] });
  });

  it('renews (create + drop) a registration inside the renew window, including exactly at its edge', () => {
    const expiring = registration('c1', 2);

    const plan = planRegistrations({
      courseIds: ['c1'],
      stored: [expiring],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [], create: ['c1'], drop: [expiring] });
  });

  it('renews an already-expired registration', () => {
    const expired = registration('c1', -1);

    const plan = planRegistrations({
      courseIds: ['c1'],
      stored: [expired],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [], create: ['c1'], drop: [expired] });
  });

  it('drops registrations for courses no active user follows any more', () => {
    const orphan = registration('gone', 6);

    const plan = planRegistrations({
      courseIds: [],
      stored: [orphan],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [], create: [], drop: [orphan] });
  });

  it('keeps only one healthy registration per course and drops duplicates', () => {
    const first = registration('c1', 5, 'reg-a');
    const duplicate = registration('c1', 6, 'reg-b');

    const plan = planRegistrations({
      courseIds: ['c1'],
      stored: [first, duplicate],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan).toEqual({ keep: [first], create: [], drop: [duplicate] });
  });

  it('de-duplicates course ids followed by more than one user', () => {
    const plan = planRegistrations({
      courseIds: ['c1', 'c1'],
      stored: [],
      now: NOW,
      renewBeforeMs: RENEW_BEFORE,
    });

    expect(plan.create).toEqual(['c1']);
  });
});
