import { MS_PER_DAY } from '../core/time.js';
import type { Instant } from '../core/types.js';
import type { Clock } from '../ports/Clock.js';
import type { SheetLogger } from '../adapters/sheets/SheetLogger.js';

/** "configurable retention" per the plan's M8 task — tune here, same pattern as onInstall.ts's SYNC_INTERVAL_MINUTES. */
export const LOG_RETENTION_DAYS = 30;

/** Deliberately narrower than Notifier, same reasoning as syncReminders.ts's ErrorAlerter. */
export interface HeartbeatSender {
  sendHeartbeat(text: string): void;
}

export interface HeartbeatDeps {
  clock: Clock;
  logger: SheetLogger;
  sender: HeartbeatSender;
  retentionDays?: number;
}

/**
 * Run once a day by a separate trigger from the 10-minute sync — its only job is to
 * prove the script itself is still alive even on a day with nothing to remind about,
 * and to keep the Log tab from growing forever. Deliberately independent of sync
 * success/failure: silence from *this* trigger (not from Slack in general) is what
 * should worry the user, since the two-strikes alert in syncReminders.ts already
 * covers sync-specific failures.
 */
export function runHeartbeat(deps: HeartbeatDeps): void {
  const { clock, logger, sender } = deps;
  const retentionDays = deps.retentionDays ?? LOG_RETENTION_DAYS;
  const cutoff: Instant = clock.now() - retentionDays * MS_PER_DAY;

  const prunedCount = logger.prune(cutoff);
  sender.sendHeartbeat(`Classroom Reminder Bot heartbeat: still running. Pruned ${prunedCount} log row(s) older than ${retentionDays}d.`);
  logger.log('INFO', 'heartbeat', 'Daily heartbeat sent', { prunedCount });
}
