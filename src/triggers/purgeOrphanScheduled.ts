import type { DeliveryStore } from '../ports/DeliveryStore.js';
import type { Lock } from '../infra/lock.js';
import type { SheetLogger } from '../adapters/sheets/SheetLogger.js';
import type { ScheduledSlackMessage } from '../adapters/slack/SlackNotifier.js';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/** Deliberately narrower than SlackNotifier — only the two calls the purge needs. */
export interface ScheduledMessageQueue {
  listScheduled(): ScheduledSlackMessage[];
  cancel(externalMessageId: string): void;
}

export interface PurgeOrphanScheduledDeps {
  lock: Lock;
  logger: SheetLogger;
  configStore: { loadAll(): { userId: string }[] };
  deliveryStore: DeliveryStore;
  queue: ScheduledMessageQueue;
  lockTimeoutMs?: number;
}

/**
 * One-off cleanup, run by hand: deletes every message still queued in the DM that no
 * 'scheduled' Deliveries row owns. Those orphans are what the pre-ADR-14 sync loop
 * left behind — scheduled with Slack, never recorded, then scheduled again — and
 * they'd otherwise each arrive as a duplicate. Holds the script lock so a concurrent
 * sync can't schedule a message between the Sheet read and the Slack list.
 *
 * Returns how many were deleted, or null when the lock was busy and nothing ran.
 */
export function runPurgeOrphanScheduled(deps: PurgeOrphanScheduledDeps): number | null {
  const { lock, logger, configStore, deliveryStore, queue } = deps;

  if (!lock.tryAcquire(deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS)) {
    logger.log('WARN', 'purge', 'Lock not acquired, nothing purged — run it again');
    return null;
  }

  try {
    const owned = new Set<string>();
    for (const { userId } of configStore.loadAll()) {
      for (const delivery of deliveryStore.loadDeliveries(userId)) {
        if (delivery.status === 'scheduled' && delivery.externalMessageId !== null) {
          owned.add(delivery.externalMessageId);
        }
      }
    }

    const orphans = queue.listScheduled().filter((message) => !owned.has(message.id));
    for (const orphan of orphans) {
      queue.cancel(orphan.id);
    }
    logger.log('INFO', 'purge', 'Deleted orphaned scheduled Slack messages', { deleted: orphans.length, kept: owned.size });
    return orphans.length;
  } finally {
    lock.release();
  }
}
