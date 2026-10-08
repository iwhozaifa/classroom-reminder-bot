// Entry point bundled by esbuild into dist/Code.js. Apps Script invokes trigger
// functions by global name, and the IIFE bundle gives each module its own closure
// — so every global Apps Script calls gets attached here via
// `(globalThis as Record<string, unknown>).name = fn;`, never declared loose.
import { setupSheet } from '../scripts/setup-sheet.js';
import { ClassroomApiSource } from './adapters/classroom/ClassroomApiSource.js';
import { SheetLogger } from './adapters/sheets/SheetLogger.js';
import { LOG_SHEET_NAME } from './adapters/sheets/schema.js';
import { UrlFetchAppHttpClient } from './infra/UrlFetchAppHttpClient.js';
import { SystemClock } from './infra/SystemClock.js';

export const BOOTSTRAP_VERSION = '0.1.0';

function getSheetId(): string {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Script Property SHEET_ID is not set.');
  return sheetId;
}

/** `clasp run setupSheet` — one-shot, idempotent, see scripts/setup-sheet.ts. */
function runSetupSheet(): void {
  setupSheet(SpreadsheetApp.openById(getSheetId()));
}

/**
 * `clasp run listMyCourses` — logs every course the account is enrolled in as a
 * student (id + name) to the Executions log, so the user can copy ids straight
 * into Config.course_ids without hunting through the Classroom UI.
 */
function runListMyCourses(): void {
  const spreadsheet = SpreadsheetApp.openById(getSheetId());
  const logSheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) throw new Error(`Sheet tab "${LOG_SHEET_NAME}" not found — run setupSheet first.`);

  const source = new ClassroomApiSource({
    httpClient: new UrlFetchAppHttpClient(),
    oauthToken: ScriptApp.getOAuthToken(),
    logger: new SheetLogger(logSheet, new SystemClock()),
    retry: { maxAttempts: 4, baseDelayMs: 500, sleep: Utilities.sleep },
  });

  const courses = source.listMyCourses();
  if (courses.length === 0) {
    Logger.log('No active courses found for this account.');
    return;
  }
  for (const course of courses) {
    Logger.log(`${course.id}\t${course.name}`);
  }
}

(globalThis as Record<string, unknown>).setupSheet = runSetupSheet;
(globalThis as Record<string, unknown>).listMyCourses = runListMyCourses;
