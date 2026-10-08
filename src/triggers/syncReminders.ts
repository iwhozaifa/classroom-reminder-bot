import { planDeliveries } from '../core/planDeliveries.js';
import { reconcile } from '../core/reconcile.js';
import type { ChannelCapabilities, ChannelId, Delivery, DeliveryChange, UserConfig } from '../core/types.js';
import type { Clock } from '../ports/Clock.js';
import type { ClassroomSource } from '../ports/ClassroomSource.js';
import type { DeliveryStore } from '../ports/DeliveryStore.js';
import type { Notifier } from '../ports/Notifier.js';
import type { ReminderStore } from '../ports/ReminderStore.js';
import type { Lock } from '../infra/lock.js';
import type { SheetLogger } from '../adapters/sheets/SheetLogger.js';
import type { SheetConfigStore } from '../adapters/sheets/SheetConfigStore.js';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/** "on reaching 2, send a distinct error-alert DM every failing run until it recovers" — per the plan's M8 task. */
const FAILURE_ALERT_THRESHOLD = 2;

/** Deliberately narrower than Notifier — sendErrorAlert has no non-scheduling-channel
 * equivalent (see SlackNotifier's own doc comment), so the watchdog depends on just
 * this shape instead of pulling Slack-specific methods into the real Notifier port. */
export interface ErrorAlerter {
  sendErrorAlert(text: string): void;
}

export interface SyncCycleDeps {
  clock: Clock;
  config: UserConfig;
  courseIds: string[];
  source: ClassroomSource;
  reminderStore: ReminderStore;
  deliveryStore: DeliveryStore;
  notifiers: Record<ChannelId, Notifier>;
  activeChannels: ChannelId[];
}

/**
 * One user's worth of reconcile() + planDeliveries(), executed against real ports.
 * Pure in the sense that it only ever touches ports — no Apps Script global, no
 * concrete adapter — which is what lets M3's integration tests exercise this exact
 * function (not a stand-in) against fakes.
 *
 * `planDeliveries()` deliberately never reports whether a `notifierAction` actually
 * succeeded (it can't — it does no I/O). Turning each executed action's outcome into
 * the DeliveryChange that records it is exactly this function's job.
 */
export function runSyncCycle(deps: SyncCycleDeps): void {
  const { clock, config, courseIds, source, reminderStore, deliveryStore, notifiers, activeChannels } = deps;
  const now = clock.now();

  const liveAssignments = source.listAssignments(config.userId, courseIds);
  const storedReminders = reminderStore.loadReminders(config.userId);
  const reconcileResult = reconcile({ now, config, liveAssignments, storedReminders });
  reminderStore.applyChanges(reconcileResult.changes);

  const storedDeliveries = deliveryStore.loadDeliveries(config.userId);
  const channelCapabilities: Record<ChannelId, ChannelCapabilities> = {};
  for (const channel of activeChannels) {
    channelCapabilities[channel] = { supportsScheduling: notifiers[channel]!.supportsScheduling };
  }

  const planResult = planDeliveries({
    now,
    desiredReminders: reconcileResult.desiredReminders,
    storedDeliveries,
    activeChannels,
    channelCapabilities,
  });

  const executedChanges: DeliveryChange[] = [...planResult.changes];
  for (const action of planResult.notifierActions) {
    const notifier = notifiers[action.delivery.channel]!;
    const text = describe(action.delivery);

    if (action.kind === 'scheduleCreate') {
      executedChanges.push(runSchedule(notifier, action.delivery, text));
    } else if (action.kind === 'scheduleCancel') {
      notifier.cancel(action.delivery.externalMessageId!);
    } else {
      executedChanges.push(runSendNow(notifier, action.delivery, text));
    }
  }

  deliveryStore.applyChanges(executedChanges);
}

function runSchedule(notifier: Notifier, delivery: Delivery, text: string): DeliveryChange {
  try {
    const externalMessageId = notifier.schedule(delivery, text, delivery.fireAt);
    return { kind: 'create', delivery: { ...delivery, status: 'scheduled', externalMessageId } };
  } catch {
    return { kind: 'create', delivery: { ...delivery, status: 'failed', externalMessageId: null } };
  }
}

function runSendNow(notifier: Notifier, delivery: Delivery, text: string): DeliveryChange {
  try {
    const externalMessageId = notifier.sendNow(delivery, text);
    return { kind: 'markSent', delivery: { ...delivery, status: 'sent', externalMessageId } };
  } catch {
    return { kind: 'markFailed', delivery: { ...delivery, status: 'failed', externalMessageId: null } };
  }
}

function describe(delivery: Delivery): string {
  return `Reminder: ${delivery.assignmentId} (${delivery.reminderType})`;
}

export interface SyncRemindersDeps {
  lock: Lock;
  clock: Clock;
  logger: SheetLogger;
  configStore: SheetConfigStore;
  source: ClassroomSource;
  reminderStore: ReminderStore;
  deliveryStore: DeliveryStore;
  notifiers: Record<ChannelId, Notifier>;
  alerter: ErrorAlerter;
  lockTimeoutMs?: number;
}

/**
 * The real orchestrator, run every 10 minutes by the trigger `onInstall.ts`
 * registers. Acquires the script lock first (skip-and-log on contention, per the
 * plan — never block, since the next cycle is 10 minutes away regardless);
 * everything else happens only while held, released in `finally` so a crash never
 * leaves the lock stuck until Apps Script's own timeout.
 *
 * One user's failure (e.g. a Classroom/Slack outage) is logged and never stops the
 * rest from being processed — matches the per-course isolation already built into
 * ClassroomApiSource. Turning a failure into the two-strikes watchdog alert is M8's
 * job, layered on top of this same catch block.
 */
export function runSyncReminders(deps: SyncRemindersDeps): void {
  const { lock, clock, logger, configStore, source, reminderStore, deliveryStore, notifiers, alerter } = deps;

  if (!lock.tryAcquire(deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS)) {
    logger.log('WARN', 'sync', 'Lock not acquired, skipping this cycle');
    return;
  }

  try {
    const configs = configStore.loadAll().filter((c) => c.active);
    for (const storedConfig of configs) {
      try {
        runSyncCycle({
          clock,
          config: {
            userId: storedConfig.userId,
            timezone: storedConfig.timezone,
            rollingWindowDays: storedConfig.rollingWindowDays,
          },
          courseIds: storedConfig.courseIds,
          source,
          reminderStore,
          deliveryStore,
          notifiers,
          activeChannels: storedConfig.activeChannels,
        });
        logger.log('INFO', 'sync', 'Sync cycle completed', { userId: storedConfig.userId });
        if (storedConfig.consecutiveFailureCount !== 0) {
          configStore.update(storedConfig.userId, { consecutiveFailureCount: 0 });
        }
      } catch (error) {
        handleSyncFailure(storedConfig, error, { configStore, logger, alerter });
      }
    }
  } finally {
    lock.release();
  }
}

/**
 * Increments and persists the per-user failure streak, then alerts once it reaches
 * FAILURE_ALERT_THRESHOLD — and every run after that, until a success resets it to
 * zero above. A failure here (e.g. Slack itself is down) is logged but never allowed
 * to escape, so one user's broken alert can't stop the next user's cycle from running.
 */
function handleSyncFailure(
  storedConfig: { userId: string; displayName: string; consecutiveFailureCount: number },
  error: unknown,
  deps: { configStore: SheetConfigStore; logger: SheetLogger; alerter: ErrorAlerter },
): void {
  const { configStore, logger, alerter } = deps;
  const failureCount = storedConfig.consecutiveFailureCount + 1;
  const message = error instanceof Error ? error.message : String(error);
  configStore.update(storedConfig.userId, { consecutiveFailureCount: failureCount });
  logger.log('ERROR', 'sync', 'Sync cycle failed for user', { userId: storedConfig.userId, failureCount, error: message });

  if (failureCount >= FAILURE_ALERT_THRESHOLD) {
    try {
      alerter.sendErrorAlert(`Sync has now failed ${failureCount} times in a row for ${storedConfig.displayName}: ${message}`);
    } catch (alertError) {
      logger.log('ERROR', 'sync', 'Failed to send watchdog error alert', {
        userId: storedConfig.userId,
        error: alertError instanceof Error ? alertError.message : String(alertError),
      });
    }
  }
}
