import { planDeliveries } from '../../src/core/planDeliveries.js';
import { reconcile } from '../../src/core/reconcile.js';
import type { ChannelCapabilities, ChannelId, Delivery, DeliveryChange, UserConfig } from '../../src/core/types.js';
import type { Clock } from '../../src/ports/Clock.js';
import type { ClassroomSource } from '../../src/ports/ClassroomSource.js';
import type { DeliveryStore } from '../../src/ports/DeliveryStore.js';
import type { Notifier } from '../../src/ports/Notifier.js';
import type { ReminderStore } from '../../src/ports/ReminderStore.js';

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
 * Test-only stand-in for M7's real `triggers/syncReminders.ts`. It exists so M3's
 * integration tests can exercise `reconcile()` + `planDeliveries()` end-to-end
 * against fakes, with the minimum glue needed to do that — no LockService, retry, or
 * error-alerting here; that wiring is M7's job against real adapters, not this one's.
 *
 * `planDeliveries()` deliberately never reports whether a `notifierAction` actually
 * succeeded (it can't — it does no I/O). Turning each executed action's outcome into
 * the DeliveryChange that records it is exactly the orchestrator's responsibility,
 * which is what the schedule/sendNow helpers below do.
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
