type ScriptAppType = GoogleAppsScript.Script.ScriptApp;

export const SYNC_TRIGGER_FUNCTION = 'syncReminders';
export const HEARTBEAT_TRIGGER_FUNCTION = 'heartbeat';

/**
 * Every 4 hours (ADR 15). Slack holds every scheduled reminder and posts it at the
 * exact second on its own, so this interval never delays a reminder — it only bounds
 * how long a Classroom change (new assignment, due-date change, turn-in) takes to be
 * noticed. 6 runs a day instead of 144 keeps the Executions log readable. Free push
 * isn't available (ADR 13). Must be one of Apps Script's allowed everyHours values
 * (1, 2, 4, 6, 8, 12).
 */
export const SYNC_SWEEP_HOURS = 4;

/** Hour of day (script timezone, see appsscript.json) the daily heartbeat fires. */
export const HEARTBEAT_HOUR_OF_DAY = 8;

function reinstall(scriptApp: ScriptAppType, handlerFunction: string, create: () => void): void {
  for (const trigger of scriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === handlerFunction) {
      scriptApp.deleteTrigger(trigger);
    }
  }
  create();
}

/**
 * Idempotent, same pattern as scripts/setup-sheet.ts: delete any existing trigger
 * for this function first, so re-running never produces duplicates (and therefore
 * never produces duplicate concurrent runs — which the lock in syncReminders.ts
 * guards against anyway, but there's no reason to rely on that when avoiding the
 * duplicate in the first place is just as cheap).
 */
export function installSyncTrigger(scriptApp: ScriptAppType): void {
  reinstall(scriptApp, SYNC_TRIGGER_FUNCTION, () => {
    scriptApp.newTrigger(SYNC_TRIGGER_FUNCTION).timeBased().everyHours(SYNC_SWEEP_HOURS).create();
  });
}

/** Same idempotency guarantee as installSyncTrigger, registered separately per the plan
 * ("separate daily heartbeat trigger") rather than piggybacked on the sync sweep. */
export function installHeartbeatTrigger(scriptApp: ScriptAppType): void {
  reinstall(scriptApp, HEARTBEAT_TRIGGER_FUNCTION, () => {
    scriptApp.newTrigger(HEARTBEAT_TRIGGER_FUNCTION).timeBased().everyDays(1).atHour(HEARTBEAT_HOUR_OF_DAY).create();
  });
}

/** Convenience for a fresh install — registers every trigger in one call. */
export function installAllTriggers(scriptApp: ScriptAppType): void {
  installSyncTrigger(scriptApp);
  installHeartbeatTrigger(scriptApp);
}
