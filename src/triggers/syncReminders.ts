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
  const { lock, clock, logger, configStore, source, reminderStore, deliveryStore, notifiers } = deps;

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
      } catch (error) {
        logger.log('ERROR', 'sync', 'Sync cycle failed for user', {
          userId: storedConfig.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    lock.release();
  }
}
