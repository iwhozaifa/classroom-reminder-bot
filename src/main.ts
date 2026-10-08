// Entry point bundled by esbuild into dist/Code.js. Apps Script invokes trigger
// functions by global name, and the IIFE bundle gives each module its own closure
// — so every global Apps Script calls gets attached here via
// `(globalThis as Record<string, unknown>).name = fn;`, never declared loose.
import { setupSheet } from '../scripts/setup-sheet.js';
import { ClassroomApiSource } from './adapters/classroom/ClassroomApiSource.js';
import { SheetConfigStore } from './adapters/sheets/SheetConfigStore.js';
import { SheetLogger } from './adapters/sheets/SheetLogger.js';
import { SheetReminderStore } from './adapters/sheets/SheetReminderStore.js';
import { CONFIG_SHEET_NAME, DELIVERIES_SHEET_NAME, LOG_SHEET_NAME, REMINDERS_SHEET_NAME } from './adapters/sheets/schema.js';
import { SlackNotifier } from './adapters/slack/SlackNotifier.js';
import type { ChannelId } from './core/types.js';
import { loadScriptSecrets, saveSlackDmChannelId } from './infra/config.js';
import { ScriptServiceLock } from './infra/lock.js';
import { SystemClock } from './infra/SystemClock.js';
import { UrlFetchAppHttpClient } from './infra/UrlFetchAppHttpClient.js';
import type { Notifier } from './ports/Notifier.js';
import { installAllTriggers } from './triggers/onInstall.js';
import { runHeartbeat } from './triggers/heartbeat.js';
import { runSyncReminders } from './triggers/syncReminders.js';

export const BOOTSTRAP_VERSION = '0.1.0';

/** A function, not a top-level constant — module-level code must never touch an Apps
 * Script global (test/scaffold.test.ts asserts this file imports cleanly under plain
 * Node/Vitest, with no Apps Script runtime present). */
function retryOptions(): { maxAttempts: number; baseDelayMs: number; sleep: (ms: number) => void } {
  return { maxAttempts: 4, baseDelayMs: 500, sleep: Utilities.sleep };
}

function getSheet(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet, name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet tab "${name}" not found — run setupSheet first.`);
  return sheet;
}

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
  const logSheet = getSheet(spreadsheet, LOG_SHEET_NAME);

  const source = new ClassroomApiSource({
    httpClient: new UrlFetchAppHttpClient(),
    oauthToken: ScriptApp.getOAuthToken(),
    logger: new SheetLogger(logSheet, new SystemClock()),
    retry: retryOptions(),
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

/**
 * `syncReminders` — the function the 10-minute trigger (registered by
 * `installSyncTrigger`) actually calls. Builds every real adapter, runs one cycle
 * via `runSyncReminders`, then persists a freshly-resolved Slack DM channel id back
 * to Script Properties so it isn't re-resolved every cycle (SlackNotifier only
 * knows how to report it back, not where to put it — that's this wiring's job).
 */
function runSync(): void {
  const secrets = loadScriptSecrets();
  const spreadsheet = SpreadsheetApp.openById(secrets.sheetId);
  const clock = new SystemClock();
  const logger = new SheetLogger(getSheet(spreadsheet, LOG_SHEET_NAME), clock);
  const configStore = new SheetConfigStore(getSheet(spreadsheet, CONFIG_SHEET_NAME));
  const reminderAndDeliveryStore = new SheetReminderStore(
    getSheet(spreadsheet, REMINDERS_SHEET_NAME),
    getSheet(spreadsheet, DELIVERIES_SHEET_NAME),
    clock,
  );

  const slackNotifier = new SlackNotifier({
    httpClient: new UrlFetchAppHttpClient(),
    botToken: secrets.slackBotToken,
    slackUserId: secrets.slackUserId,
    dmChannelId: secrets.slackDmChannelId,
    retry: retryOptions(),
  });
  const notifiers: Record<ChannelId, Notifier> = { slack: slackNotifier };

  const source = new ClassroomApiSource({
    httpClient: new UrlFetchAppHttpClient(),
    oauthToken: ScriptApp.getOAuthToken(),
    logger,
    retry: retryOptions(),
  });

  runSyncReminders({
    lock: new ScriptServiceLock(),
    clock,
    logger,
    configStore,
    source,
    reminderStore: reminderAndDeliveryStore,
    deliveryStore: reminderAndDeliveryStore,
    notifiers,
    alerter: slackNotifier,
  });

  const resolvedDmChannelId = slackNotifier.getDmChannelId();
  if (resolvedDmChannelId && resolvedDmChannelId !== secrets.slackDmChannelId) {
    saveSlackDmChannelId(resolvedDmChannelId);
  }
}

/**
 * `heartbeat` — the function the daily trigger (registered by `installAllTriggers`)
 * calls. Independent of sync success/failure by design (see heartbeat.ts); also
 * prunes old Log rows so the tab doesn't grow forever.
 */
function runDailyHeartbeat(): void {
  const secrets = loadScriptSecrets();
  const spreadsheet = SpreadsheetApp.openById(secrets.sheetId);
  const clock = new SystemClock();
  const logger = new SheetLogger(getSheet(spreadsheet, LOG_SHEET_NAME), clock);

  const sender = new SlackNotifier({
    httpClient: new UrlFetchAppHttpClient(),
    botToken: secrets.slackBotToken,
    slackUserId: secrets.slackUserId,
    dmChannelId: secrets.slackDmChannelId,
    retry: retryOptions(),
  });

  runHeartbeat({ clock, logger, sender });
}

/** `clasp run runInstallAllTriggers` — one-shot, idempotent, see triggers/onInstall.ts. */
function runInstallAllTriggers(): void {
  installAllTriggers(ScriptApp);
}

(globalThis as Record<string, unknown>).setupSheet = runSetupSheet;
(globalThis as Record<string, unknown>).listMyCourses = runListMyCourses;
(globalThis as Record<string, unknown>).syncReminders = runSync;
(globalThis as Record<string, unknown>).heartbeat = runDailyHeartbeat;
(globalThis as Record<string, unknown>).installAllTriggers = runInstallAllTriggers;
