type ScriptAppType = GoogleAppsScript.Script.ScriptApp;

export const SYNC_TRIGGER_FUNCTION = 'syncReminders';
export const HEARTBEAT_TRIGGER_FUNCTION = 'heartbeat';
export const RENEW_REGISTRATIONS_TRIGGER_FUNCTION = 'renewPushRegistrations';
export const CATCH_UP_SYNC_FUNCTION = 'catchUpSync';

/** How long after a lock-busy push the one-shot catch-up sync runs. */
export const CATCH_UP_DELAY_MS = 60_000;

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

/**
 * A push that hit a busy lock can't be nacked back to Pub/Sub (Apps Script always
 * answers 200), so without this it would wait for the 6-hour sweep. Schedules one
 * one-shot full sync shortly after instead — and only one: if a catch-up is already
 * pending it covers this push too, which also keeps a burst of pushes from piling
 * up toward Apps Script's 20-triggers-per-script limit.
 */
export function scheduleCatchUpSync(scriptApp: ScriptAppType): boolean {
  const pending = scriptApp
    .getProjectTriggers()
    .some((trigger) => trigger.getHandlerFunction() === CATCH_UP_SYNC_FUNCTION);
  if (pending) return false;
  scriptApp.newTrigger(CATCH_UP_SYNC_FUNCTION).timeBased().after(CATCH_UP_DELAY_MS).create();
  return true;
}

/**
 * A fired one-shot trigger stays listed (and counts toward the limit) until deleted,
 * so the catch-up handler removes its own before doing anything else — which also
 * lets it schedule a fresh one if the lock is *still* busy.
 */
export function clearCatchUpSync(scriptApp: ScriptAppType): void {
  for (const trigger of scriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === CATCH_UP_SYNC_FUNCTION) {
      scriptApp.deleteTrigger(trigger);
    }
  }
}
