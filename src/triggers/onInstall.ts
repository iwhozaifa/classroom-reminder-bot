type ScriptAppType = GoogleAppsScript.Script.ScriptApp;

export const SYNC_TRIGGER_FUNCTION = 'syncReminders';
export const HEARTBEAT_TRIGGER_FUNCTION = 'heartbeat';
export const RENEW_REGISTRATIONS_TRIGGER_FUNCTION = 'renewPushRegistrations';

/**
 * Safety-net sweep, not the primary change detector — Classroom push (pushSync.ts)
 * is (ADR 13). The sweep still has to exist: reconcile() depends on `now`, and no
 * Classroom event fires when a no-due-date assignment's rolling window simply
 * advances, or when a push was lost. 6 hours keeps every one of those within a
 * fraction of the 24h top-up horizon. Must be one of Apps Script's allowed
 * everyHours values (1, 2, 4, 6, 8, 12).
 */
export const SYNC_SWEEP_HOURS = 6;

/** Hour of day (script timezone, see appsscript.json) the daily heartbeat fires. */
export const HEARTBEAT_HOUR_OF_DAY = 8;

/** Hour of day the daily push-registration renewal fires — off-peak, away from the heartbeat. */
export const RENEW_REGISTRATIONS_HOUR_OF_DAY = 3;

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

/** Same idempotency guarantee — daily, since Classroom registrations expire after ~7 days. */
export function installRenewRegistrationsTrigger(scriptApp: ScriptAppType): void {
  reinstall(scriptApp, RENEW_REGISTRATIONS_TRIGGER_FUNCTION, () => {
    scriptApp
      .newTrigger(RENEW_REGISTRATIONS_TRIGGER_FUNCTION)
      .timeBased()
      .everyDays(1)
      .atHour(RENEW_REGISTRATIONS_HOUR_OF_DAY)
      .create();
  });
}

/** Convenience for a fresh install — registers every trigger in one call. */
export function installAllTriggers(scriptApp: ScriptAppType): void {
  installSyncTrigger(scriptApp);
  installHeartbeatTrigger(scriptApp);
  installRenewRegistrationsTrigger(scriptApp);
}
