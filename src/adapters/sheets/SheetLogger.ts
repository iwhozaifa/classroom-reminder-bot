import type { Instant } from '../../core/types.js';
import type { Clock } from '../../ports/Clock.js';
import { readDataRows, writeDataRows } from './sheetIO.js';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogSource = 'sync' | 'slack' | 'classroom' | 'heartbeat' | 'whatsapp';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/**
 * Append-only by design — unlike Reminders/Deliveries there's no desired-state to
 * diff against, just a running trail. Pruning old rows is M8's job, not this one's.
 * Not behind a port: core never logs (it's pure), and nothing else in this project
 * will ever implement logging differently, so an interface would buy no real
 * flexibility — triggers/infra call this class directly.
 */
export class SheetLogger {
  constructor(
    private readonly sheet: Sheet,
    private readonly clock: Clock,
  ) {}

  log(level: LogLevel, source: LogSource, message: string, context?: Record<string, unknown>): void {
    const timestamp = new Date(this.clock.now()).toISOString();
    this.sheet.appendRow([timestamp, level, source, message, context ? JSON.stringify(context) : '']);
  }

  /** Deletes every row whose timestamp is older than `cutoff`, in one batched rewrite. Returns the count removed. */
  prune(cutoff: Instant): number {
    const rows = readDataRows(this.sheet);
    const kept = rows.filter((row) => Date.parse(String(row[0])) >= cutoff);
    const prunedCount = rows.length - kept.length;
    if (prunedCount > 0) writeDataRows(this.sheet, kept);
    return prunedCount;
  }
}
