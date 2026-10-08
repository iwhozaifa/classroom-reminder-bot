import type { Clock } from '../../ports/Clock.js';

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
}
