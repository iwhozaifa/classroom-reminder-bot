import type { SheetConfigStore } from '../adapters/sheets/SheetConfigStore.js';
import type { SheetLogger } from '../adapters/sheets/SheetLogger.js';
import { planRegistrations } from '../core/registrations.js';
import { MS_PER_DAY } from '../core/time.js';
import type { Registration } from '../core/types.js';
import type { Clock } from '../ports/Clock.js';
import type { PushRegistrar } from '../ports/PushRegistrar.js';
import type { RegistrationStore } from '../ports/RegistrationStore.js';
import type { ErrorAlerter } from './syncReminders.js';

/** Classroom registrations live ~7 days; renewing at 2 days left gives a daily job two spare runs. */
export const RENEW_BEFORE_MS = 2 * MS_PER_DAY;

export interface RenewRegistrationsDeps {
  clock: Clock;
  logger: SheetLogger;
  configStore: SheetConfigStore;
  registrar: PushRegistrar;
  registrationStore: RegistrationStore;
  alerter: ErrorAlerter;
  /** `projects/<project>/topics/<topic>` */
  topicName: string;
}

/**
 * Daily: make sure every course an active user follows has a live registration,
 * and nothing else does. A failed create is logged and alerted but never stops the
 * rest — and the sync sweep keeps running regardless, so a lapsed registration only
 * ever costs latency, never a missed reminder.
 */
export function runRenewRegistrations(deps: RenewRegistrationsDeps): void {
  const { clock, logger, configStore, registrar, registrationStore, alerter, topicName } = deps;

  const courseIds = configStore
    .loadAll()
    .filter((c) => c.active)
    .flatMap((c) => c.courseIds);
  const plan = planRegistrations({
    courseIds,
    stored: registrationStore.load(),
    now: clock.now(),
    renewBeforeMs: RENEW_BEFORE_MS,
  });

  const live: Registration[] = [...plan.keep];
  const failedCourses: string[] = [];
  for (const courseId of plan.create) {
    try {
      live.push(registrar.register(courseId, topicName));
    } catch (error) {
      failedCourses.push(courseId);
      logger.log('ERROR', 'push', 'Failed to create push registration', {
        courseId,
        error: errorMessage(error),
      });
    }
  }

  for (const registration of plan.drop) {
    try {
      registrar.unregister(registration.registrationId);
    } catch (error) {
      // Not kept in the store either way — it expires on its own, and any stray
      // pushes it sends are harmless (handled exactly like a real one).
      logger.log('WARN', 'push', 'Failed to delete push registration', {
        courseId: registration.courseId,
        registrationId: registration.registrationId,
        error: errorMessage(error),
      });
    }
  }

  registrationStore.replaceAll(live);
  logger.log('INFO', 'push', 'Push registrations renewed', {
    kept: plan.keep.length,
    created: plan.create.length - failedCourses.length,
    dropped: plan.drop.length,
    failed: failedCourses.length,
  });

  if (failedCourses.length > 0) {
    try {
      alerter.sendErrorAlert(
        `Couldn't register Classroom push notifications for ${failedCourses.join(', ')} — falling back to the periodic sync for those courses.`,
      );
    } catch (error) {
      logger.log('ERROR', 'push', 'Failed to send registration error alert', {
        error: errorMessage(error),
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
