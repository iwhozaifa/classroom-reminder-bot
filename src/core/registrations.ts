import type { Instant, Registration } from './types.js';

export interface PlanRegistrationsInput {
  /** Every course some active user follows — duplicates are fine. */
  courseIds: string[];
  stored: Registration[];
  now: Instant;
  /** Renew a registration once it has this long (or less) left to live. */
  renewBeforeMs: number;
}

export interface RegistrationPlan {
  /** Still valid for longer than the renew window — left untouched. */
  keep: Registration[];
  /** Courses that need a fresh registration (none yet, or the current one is about to lapse). */
  create: string[];
  /** Registrations to delete: renewed ones, and ones for courses nobody follows any more. */
  drop: Registration[];
}

/**
 * Same full-state-recompute shape as reconcile() (ADR 6): given what should be
 * registered and what is, say exactly what to create and what to delete. Renewal is
 * create-then-drop rather than an in-place extend, because Classroom has no endpoint
 * to extend a registration's expiry.
 */
export function planRegistrations(input: PlanRegistrationsInput): RegistrationPlan {
  const { courseIds, stored, now, renewBeforeMs } = input;
  const wanted = new Set(courseIds);
  const plan: RegistrationPlan = { keep: [], create: [], drop: [] };

  const healthyCourses = new Set<string>();
  for (const registration of stored) {
    const isWanted = wanted.has(registration.courseId);
    const isFresh = registration.expiresAt - now > renewBeforeMs;
    if (isWanted && isFresh && !healthyCourses.has(registration.courseId)) {
      plan.keep.push(registration);
      healthyCourses.add(registration.courseId);
    } else {
      plan.drop.push(registration);
    }
  }

  for (const courseId of wanted) {
    if (!healthyCourses.has(courseId)) plan.create.push(courseId);
  }
  return plan;
}
