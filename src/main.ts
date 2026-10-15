// Entry point bundled by esbuild into dist/Code.js. Apps Script invokes functions
// by global name, and the editor's Run dropdown only lists top-level `function`
// declarations — neither can see inside the IIFE bundle. So every function Apps
// Script calls is listed in `entryPoints` below, and scripts/build.mjs appends a
// real top-level `function <name>()` stub per key that delegates into the bundle.
import { setupSheet } from '../scripts/setup-sheet.js';
import { ClassroomApiSource } from './adapters/classroom/ClassroomApiSource.js';
import { SheetConfigStore } from './adapters/sheets/SheetConfigStore.js';
import { SheetLogger } from './adapters/sheets/SheetLogger.js';
import { SheetReminderStore } from './adapters/sheets/SheetReminderStore.js';
import {
  CONFIG_SHEET_NAME,
  DELIVERIES_SHEET_NAME,
  LOG_SHEET_NAME,
  REMINDERS_SHEET_NAME,
} from './adapters/sheets/schema.js';
import { SlackNotifier } from './adapters/slack/SlackNotifier.js';
import type { ChannelId } from './core/types.js';
import { loadScriptSecrets, saveSlackDmChannelId } from './infra/config.js';
import { ScriptServiceLock } from './infra/lock.js';
import { SystemClock } from './infra/SystemClock.js';
import { UrlFetchAppHttpClient } from './infra/UrlFetchAppHttpClient.js';
import type { Notifier } from './ports/Notifier.js';
import { HEARTBEAT_TRIGGER_FUNCTION, installAllTriggers, SYNC_TRIGGER_FUNCTION } from './triggers/onInstall.js';
import { runHeartbeat } from './triggers/heartbeat.js';
import { runPurgeOrphanScheduled } from './triggers/purgeOrphanScheduled.js';
import { runSyncReminders } from './triggers/syncReminders.js';
import type { SyncRemindersDeps } from './triggers/syncReminders.js';

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
 * Builds every real adapter a sync needs — shared by the sweep and the orphan purge.
 * `finish()` persists a freshly-resolved Slack DM channel id back to Script
 * Properties so it isn't re-resolved every run (SlackNotifier only knows how to
 * report it back, not where to put it — that's this wiring's job).
 */
function buildSyncDeps(): { deps: SyncRemindersDeps; finish: () => void; slackNotifier: SlackNotifier } {
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

  const deps: SyncRemindersDeps = {
    lock: new ScriptServiceLock(),
    clock,
    logger,
    configStore,
    source,
    reminderStore: reminderAndDeliveryStore,
    deliveryStore: reminderAndDeliveryStore,
    notifiers,
    alerter: slackNotifier,
  };

  const finish = (): void => {
    const resolvedDmChannelId = slackNotifier.getDmChannelId();
    if (resolvedDmChannelId && resolvedDmChannelId !== secrets.slackDmChannelId) {
      saveSlackDmChannelId(resolvedDmChannelId);
    }
  };
  return { deps, finish, slackNotifier };
}

/** `syncReminders` — the 4-hour sweep trigger (registered by `installAllTriggers`), also safe to run by hand. */
function runSync(): void {
  const { deps, finish } = buildSyncDeps();
  runSyncReminders(deps);
  finish();
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

/**
 * `purgeOrphanScheduledMessages` — one-off, run by hand from the editor: deletes
 * duplicate reminders still queued in Slack that no Deliveries row owns (see
 * triggers/purgeOrphanScheduled.ts). The count lands in the Executions log.
 */
function runPurgeOrphanScheduledMessages(): void {
  const { deps, finish, slackNotifier } = buildSyncDeps();
  const deleted = runPurgeOrphanScheduled({
    lock: deps.lock,
    logger: deps.logger,
    configStore: deps.configStore,
    deliveryStore: deps.deliveryStore,
    queue: slackNotifier,
  });
  Logger.log(deleted === null ? 'A sync is running — try again in a minute.' : `Deleted ${deleted} orphaned scheduled message(s).`);
  finish();
}

/** `clasp run installAllTriggers` — one-shot, idempotent, see triggers/onInstall.ts. */
function runInstallAllTriggers(): void {
  installAllTriggers(ScriptApp);
}

/**
 * Every function Apps Script can call by name (Run dropdown, triggers, `clasp run`).
 * scripts/build.mjs turns each key into a real top-level `function` in dist/Code.js.
 * Trigger handlers are keyed on the same constants onInstall.ts registers, so a
 * rename there can't drift away from the function that actually exists.
 */
export const entryPoints = {
  setupSheet: runSetupSheet,
  listMyCourses: runListMyCourses,
  [SYNC_TRIGGER_FUNCTION]: runSync,
  [HEARTBEAT_TRIGGER_FUNCTION]: runDailyHeartbeat,
  installAllTriggers: runInstallAllTriggers,
  purgeOrphanScheduledMessages: runPurgeOrphanScheduledMessages,
} as const;
