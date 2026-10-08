// Entry point bundled by esbuild into dist/Code.js. Apps Script invokes trigger
// functions by global name, and the IIFE bundle gives each module its own closure
// — so every global Apps Script calls gets attached here via
// `(globalThis as Record<string, unknown>).name = fn;`, never declared loose.
import { setupSheet } from '../scripts/setup-sheet.js';

export const BOOTSTRAP_VERSION = '0.1.0';

/** `clasp run setupSheet` — one-shot, idempotent, see scripts/setup-sheet.ts. */
function runSetupSheet(): void {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Script Property SHEET_ID is not set.');
  setupSheet(SpreadsheetApp.openById(sheetId));
}

(globalThis as Record<string, unknown>).setupSheet = runSetupSheet;
