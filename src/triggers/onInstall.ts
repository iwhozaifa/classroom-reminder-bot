type ScriptAppType = GoogleAppsScript.Script.ScriptApp;

export const SYNC_TRIGGER_FUNCTION = 'syncReminders';
export const HEARTBEAT_TRIGGER_FUNCTION = 'heartbeat';

/**
 * 10 minutes: worst-case detection latency stays well inside every reminder offset
 * gap in rule 3 (24h/12h/2h/1h), and comfortably under the 20-triggers/script and
 * runtime-per-day quotas confirmed in M0. Tune here if that trade-off ever needs
 * revisiting — this is the one place the interval is defined.
 */
export const SYNC_INTERVAL_MINUTES = 10;

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
    scriptApp.newTrigger(SYNC_TRIGGER_FUNCTION).timeBased().everyMinutes(SYNC_INTERVAL_MINUTES).create();
  });
}

/** Same idempotency guarantee as installSyncTrigger, registered separately per the plan
 * ("separate daily heartbeat trigger") rather than piggybacked on the 10-minute one. */
export function installHeartbeatTrigger(scriptApp: ScriptAppType): void {
  reinstall(scriptApp, HEARTBEAT_TRIGGER_FUNCTION, () => {
    scriptApp.newTrigger(HEARTBEAT_TRIGGER_FUNCTION).timeBased().everyDays(1).atHour(HEARTBEAT_HOUR_OF_DAY).create();
  });
}

/** Convenience for a fresh install — registers both triggers in one call. */
export function installAllTriggers(scriptApp: ScriptAppType): void {
  installSyncTrigger(scriptApp);
  installHeartbeatTrigger(scriptApp);
}
