// Idempotent tab + header creation for all four tabs. Lives here (not under
// src/adapters) because it's a one-shot operator action rather than part of the
// sync cycle, but it still has to ship inside dist/Code.js to be runnable via
// `clasp run setupSheet` — src/main.ts imports and registers it as a global.
import {
  CONFIG_HEADERS,
  CONFIG_SHEET_NAME,
  DELIVERIES_HEADERS,
  DELIVERIES_SHEET_NAME,
  LOG_HEADERS,
  LOG_SHEET_NAME,
  REMINDERS_HEADERS,
  REMINDERS_SHEET_NAME,
} from '../src/adapters/sheets/schema.js';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

interface TabSpec {
  name: string;
  headers: readonly string[];
}

const TABS: TabSpec[] = [
  { name: REMINDERS_SHEET_NAME, headers: REMINDERS_HEADERS },
  { name: DELIVERIES_SHEET_NAME, headers: DELIVERIES_HEADERS },
  { name: CONFIG_SHEET_NAME, headers: CONFIG_HEADERS },
  { name: LOG_SHEET_NAME, headers: LOG_HEADERS },
];

/**
 * Safe to run any number of times: `getSheetByName` finds an already-created tab
 * instead of `insertSheet` making a duplicate, and writing the same header row to
 * the same range is a no-op overwrite, never an append.
 */
export function setupSheet(spreadsheet: Spreadsheet): void {
  for (const tab of TABS) {
    const sheet = spreadsheet.getSheetByName(tab.name) ?? spreadsheet.insertSheet(tab.name);
    sheet.getRange(1, 1, 1, tab.headers.length).setValues([[...tab.headers]]);
  }
}
