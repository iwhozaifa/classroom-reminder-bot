import { pickCatchUpAction } from './rules/catchUp.js';
import type {
  ChannelCapabilities,
  ChannelId,
  Delivery,
  DeliveryChange,
  Instant,
  NotifierAction,
  Reminder,
} from './types.js';

export interface PlanDeliveriesInput {
  now: Instant;
  desiredReminders: Reminder[];
  storedDeliveries: Delivery[];
  activeChannels: ChannelId[];
  channelCapabilities: Record<ChannelId, ChannelCapabilities>;
}

export interface PlanDeliveriesResult {
  /**
   * 'create' (non-scheduling channel — fully known without I/O, stays 'pending'),
   * 'cancel', or 'markSent' for a scheduled delivery whose fire time has already
   * passed (the channel delivered it on its own). 'markFailed' exists for the
   * orchestrator to use *after* executing a notifierAction — this function can't
   * know an API call's outcome, so it never emits that itself.
   */
  changes: DeliveryChange[];
  notifierActions: NotifierAction[];
}

/**
 * Expands channel-agnostic Reminders into one Delivery per (reminder, active
 * channel), diffs against stored Deliveries, and decides what to do next. The only
 * thing this function is allowed to branch on is a channel's `supportsScheduling`
 * capability — never its name — which is what lets a future non-scheduling channel
 * (e.g. WhatsApp via CallMeBot) work with zero changes here. See the plan's
 * "Multi-channel Design" section for the full rationale.
 */
export function planDeliveries(input: PlanDeliveriesInput): PlanDeliveriesResult {
  const { now, desiredReminders, storedDeliveries, activeChannels, channelCapabilities } = input;
  const changes: DeliveryChange[] = [];
  const notifierActions: NotifierAction[] = [];

  const desiredDeliveries = buildDesiredDeliveries(desiredReminders, activeChannels);
  const storedByKey = new Map(storedDeliveries.map((d) => [deliveryKey(d), d]));

  for (const [key, desired] of desiredDeliveries) {
    const stored = storedByKey.get(key);
    // Same key = same fireAt = no-op — unless it was cancelled and is wanted again
    // with its time still ahead (turned in, then unsubmitted). A past cancelled one
    // stays cancelled: catch-up cancels superseded past reminders on purpose.
    if (stored !== undefined && !(stored.status === 'cancelled' && stored.fireAt > now)) continue;

    const caps = capabilitiesFor(channelCapabilities, desired.channel);
    if (caps.supportsScheduling) {
      notifierActions.push({ kind: 'scheduleCreate', delivery: desired });
    } else {
      changes.push({ kind: 'create', delivery: desired });
    }
  }

  for (const [key, stored] of storedByKey) {
    if (desiredDeliveries.has(key)) continue; // still desired — handled above
    if (stored.status === 'sent' || stored.status === 'cancelled' || stored.status === 'failed') continue;

    const caps = capabilitiesFor(channelCapabilities, stored.channel);
    if (caps.supportsScheduling && stored.status === 'scheduled' && stored.fireAt <= now) {
      // The channel's own infra already posted it and discarded the handle — a cancel
      // would fail (Slack: invalid_scheduled_message_id) on every cycle forever. ADR 14.
      changes.push({ kind: 'markSent', delivery: { ...stored, status: 'sent' } });
      continue;
    }

    changes.push({ kind: 'cancel', delivery: stored });
    if (caps.supportsScheduling && stored.status === 'scheduled') {
      notifierActions.push({ kind: 'scheduleCancel', delivery: stored });
    }
  }

  planCatchUpDispatch(desiredReminders, desiredDeliveries, storedByKey, now, changes, notifierActions);

  return { changes, notifierActions };
}

function buildDesiredDeliveries(
  desiredReminders: Reminder[],
  activeChannels: ChannelId[],
): Map<string, Delivery> {
  const desired = new Map<string, Delivery>();
  for (const reminder of desiredReminders) {
    for (const channel of activeChannels) {
      const delivery: Delivery = {
        userId: reminder.userId,
        assignmentId: reminder.assignmentId,
        reminderType: reminder.reminderType,
        fireAt: reminder.fireAt,
        channel,
        status: 'pending',
        externalMessageId: null,
      };
      desired.set(deliveryKey(delivery), delivery);
    }
  }
  return desired;
}

/**
 * For every still-desired delivery that's neither scheduled (Slack's own infra owns
 * delivery once that succeeds) nor terminal, decide whether it's due for an
 * immediate send. This is the *only* dispatch path for a non-scheduling channel —
 * every one of its deliveries passes through here every cycle — and the rare
 * missed-schedule fallback for a scheduling channel.
 */
function planCatchUpDispatch(
  desiredReminders: Reminder[],
  desiredDeliveries: Map<string, Delivery>,
  storedByKey: Map<string, Delivery>,
  now: Instant,
  changes: DeliveryChange[],
  notifierActions: NotifierAction[],
): void {
  const dueAtByAssignment = new Map<string, Instant | null>();
  for (const reminder of desiredReminders) {
    if (!dueAtByAssignment.has(reminder.assignmentId)) {
      dueAtByAssignment.set(reminder.assignmentId, reminder.dueAt);
    }
  }

  const groups = new Map<string, { key: string; fireAt: Instant; dueAt: Instant | null }[]>();
  for (const [key, stored] of storedByKey) {
    if (!desiredDeliveries.has(key)) continue; // a cancelled/removed row never gets a catch-up send
    if (stored.status !== 'pending' && stored.status !== 'failed') continue; // never 'scheduled' — that's Slack's job

    const groupKey = `${stored.assignmentId}:${stored.channel}`;
    const dueAt = dueAtByAssignment.get(stored.assignmentId) ?? null;
    const list = groups.get(groupKey) ?? [];
    list.push({ key, fireAt: stored.fireAt, dueAt });
    groups.set(groupKey, list);
  }

  for (const candidates of groups.values()) {
    const { send, cancel } = pickCatchUpAction(candidates, now);
    for (const key of cancel) {
      changes.push({ kind: 'cancel', delivery: storedByKey.get(key)! });
    }
    if (send !== null) {
      notifierActions.push({ kind: 'dispatchSendNow', delivery: storedByKey.get(send)! });
    }
  }
}

function capabilitiesFor(
  channelCapabilities: Record<ChannelId, ChannelCapabilities>,
  channel: ChannelId,
): ChannelCapabilities {
  return channelCapabilities[channel] ?? { supportsScheduling: false };
}

function deliveryKey(d: Pick<Delivery, 'assignmentId' | 'reminderType' | 'fireAt' | 'channel'>): string {
  return `${d.assignmentId}:${d.reminderType}:${d.fireAt}:${d.channel}`;
}
