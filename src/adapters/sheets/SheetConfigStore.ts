import { readDataRows, writeDataRows } from './sheetIO.js';
import { applyConfigPatch, rowToConfig } from './configMapping.js';
import type { StoredUserConfig } from './configMapping.js';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/**
 * Reads/writes the Config tab. Kept separate from SheetReminderStore since Config
 * isn't read/written every cycle the same way Reminders+Deliveries always are
 * together — it's read once per cycle and only written back by the watchdog (M8)
 * or future Config-editing tooling.
 */
export class SheetConfigStore {
  constructor(private readonly sheet: Sheet) {}

  loadAll(): StoredUserConfig[] {
    return readDataRows(this.sheet).map(rowToConfig);
  }

  /** Merges `patch` into the row for `userId`, leaving every other column (including
   * ones this bot doesn't model, like slack_user_id) untouched. */
  update(userId: string, patch: Partial<StoredUserConfig>): void {
    const rows = readDataRows(this.sheet);
    const index = rows.findIndex((row) => String(row[0]) === userId);
    if (index === -1) throw new Error(`No Config row found for user "${userId}"`);
    rows[index] = applyConfigPatch(rows[index]!, patch);
    writeDataRows(this.sheet, rows);
  }
}
