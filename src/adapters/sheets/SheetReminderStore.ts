import type { Clock } from '../../ports/Clock.js';
import type { DeliveryStore } from '../../ports/DeliveryStore.js';
import type { ReminderStore } from '../../ports/ReminderStore.js';
import type { Delivery, DeliveryChange, Instant, Reminder, ReminderChange } from '../../core/types.js';
import { readDataRows, writeDataRows } from './sheetIO.js';
import { deliveryKey, deliveryToRow, reminderKey, reminderToRow, rowToDelivery, rowToReminder } from './rowMapping.js';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/**
 * One class for both tabs, not two separate adapters — Reminders and Deliveries
 * are always read and written together within a single sync cycle (reconcile()
 * then planDeliveries()), so one batched round-trip per tab beats coordinating two
 * independently-constructed stores. Kept deliberately thin: logic here mirrors the
 * already-proven InMemoryReminderStore/InMemoryDeliveryStore fakes exactly, plus
 * preserving the two Sheet-only bookkeeping columns (created_at, last_attempt_at)
 * across rewrites. The manual M4 smoke test (clasp run) is this seam's main check;
 * the array<->object mapping it calls into is unit tested on its own in rowMapping.ts.
 */
export class SheetReminderStore implements ReminderStore, DeliveryStore {
  constructor(
    private readonly remindersSheet: Sheet,
    private readonly deliveriesSheet: Sheet,
    private readonly clock: Clock,
  ) {}

  loadReminders(userId: string): Reminder[] {
    return readDataRows(this.remindersSheet)
      .map(rowToReminder)
      .filter((r) => r.userId === userId);
  }

  loadDeliveries(userId: string): Delivery[] {
    return readDataRows(this.deliveriesSheet)
      .map(rowToDelivery)
      .filter((d) => d.userId === userId);
  }

  applyChanges(changes: ReminderChange[]): void;
  applyChanges(changes: DeliveryChange[]): void;
  applyChanges(changes: (ReminderChange | DeliveryChange)[]): void {
    if (changes.length === 0) return;
    if ('reminder' in changes[0]!) {
      this.applyReminderChanges(changes as ReminderChange[]);
    } else {
      this.applyDeliveryChanges(changes as DeliveryChange[]);
    }
  }

  private applyReminderChanges(changes: ReminderChange[]): void {
    const now = this.clock.now();
    const rows = readDataRows(this.remindersSheet);
    const byKey = new Map(rows.map((row) => [reminderKey(rowToReminder(row)), row]));

    for (const change of changes) {
      const key = reminderKey(change.reminder);
      if (change.kind === 'create') {
        byKey.set(key, reminderToRow(change.reminder, now, now));
      } else {
        byKey.delete(key);
      }
    }

    writeDataRows(this.remindersSheet, [...byKey.values()]);
  }

  private applyDeliveryChanges(changes: DeliveryChange[]): void {
    const now = this.clock.now();
    const rows = readDataRows(this.deliveriesSheet);
    const byKey = new Map(rows.map((row) => [deliveryKey(rowToDelivery(row)), row]));

    for (const change of changes) {
      const key = deliveryKey(change.delivery);
      const existing = byKey.get(key);
      const delivery = change.kind === 'cancel' ? { ...change.delivery, status: 'cancelled' as const } : change.delivery;
      byKey.set(key, deliveryToRow(delivery, nextLastAttempt(change, existing, now), now));
    }

    writeDataRows(this.deliveriesSheet, [...byKey.values()]);
  }
}

/**
 * last_attempt_at records when schedule()/sendNow() was last actually called — not
 * every row touch. A fresh 'create' only represents a real attempt when its status
 * says an attempt happened (scheduled/failed); a brand-new 'pending' row (the
 * non-scheduling channel's hold-until-fire-time state) has made none yet. 'cancel'
 * never attempts anything, so it just carries the existing row's value forward.
 */
function nextLastAttempt(change: DeliveryChange, existing: unknown[] | undefined, now: Instant): Instant | null {
  if (change.kind === 'cancel') return existing ? parseExistingLastAttempt(existing) : null;
  if (change.kind === 'create' && change.delivery.status === 'pending') return null;
  return now;
}

function parseExistingLastAttempt(row: unknown[]): Instant | null {
  const cell = row[7];
  if (cell === '' || cell === null || cell === undefined) return null;
  return Number(cell);
}
