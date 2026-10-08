import { describe, expect, it } from 'vitest';
import { setupSheet } from '../../../scripts/setup-sheet.js';
import {
  CONFIG_HEADERS,
  DELIVERIES_HEADERS,
  LOG_HEADERS,
  REMINDERS_HEADERS,
} from '../../../src/adapters/sheets/schema.js';
import { FakeSpreadsheet } from '../../fakes/FakeSheet.js';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

function run(spreadsheet: FakeSpreadsheet): void {
  setupSheet(spreadsheet as unknown as Spreadsheet);
}

describe('setupSheet', () => {
  it('creates all four tabs with the correct headers on a fresh spreadsheet', () => {
    const spreadsheet = new FakeSpreadsheet();
    run(spreadsheet);

    expect(spreadsheet.getSheetByName('Reminders')?.rows[0]).toEqual([...REMINDERS_HEADERS]);
    expect(spreadsheet.getSheetByName('Deliveries')?.rows[0]).toEqual([...DELIVERIES_HEADERS]);
    expect(spreadsheet.getSheetByName('Config')?.rows[0]).toEqual([...CONFIG_HEADERS]);
    expect(spreadsheet.getSheetByName('Log')?.rows[0]).toEqual([...LOG_HEADERS]);
  });

  it('is idempotent: running it twice creates no duplicate tabs and no duplicate header rows', () => {
    const spreadsheet = new FakeSpreadsheet();
    run(spreadsheet);
    run(spreadsheet);

    const reminders = spreadsheet.getSheetByName('Reminders')!;
    expect(reminders.getLastRow()).toBe(1); // still just the header row
    expect(reminders.rows).toHaveLength(1);
  });

  it('does not touch existing data rows on a second run', () => {
    const spreadsheet = new FakeSpreadsheet();
    run(spreadsheet);
    spreadsheet.getSheetByName('Reminders')!.appendRow(['u1', 'a1', 'c1', 'HW', '24h', '', 1000, 'NEW', 1000, 1000]);

    run(spreadsheet);

    expect(spreadsheet.getSheetByName('Reminders')!.rows).toHaveLength(2);
    expect(spreadsheet.getSheetByName('Reminders')!.rows[1]![0]).toBe('u1');
  });
});
