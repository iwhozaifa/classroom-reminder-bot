type ScriptAppType = GoogleAppsScript.Script.ScriptApp;

export const SYNC_TRIGGER_FUNCTION = 'syncReminders';

/**
 * 10 minutes: worst-case detection latency stays well inside every reminder offset
 * gap in rule 3 (24h/12h/2h/1h), and comfortably under the 20-triggers/script and
 * runtime-per-day quotas confirmed in M0. Tune here if that trade-off ever needs
 * revisiting — this is the one place the interval is defined.
 */
export const SYNC_INTERVAL_MINUTES = 10;

/**
 * Idempotent, same pattern as scripts/setup-sheet.ts: delete any existing trigger
 * for this function first, so re-running never produces duplicates (and therefore
 * never produces duplicate concurrent runs — which the lock in syncReminders.ts
 * guards against anyway, but there's no reason to rely on that when avoiding the
 * duplicate in the first place is just as cheap).
 */
export function installSyncTrigger(scriptApp: ScriptAppType): void {
  for (const trigger of scriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === SYNC_TRIGGER_FUNCTION) {
      scriptApp.deleteTrigger(trigger);
    }
  }
  scriptApp.newTrigger(SYNC_TRIGGER_FUNCTION).timeBased().everyMinutes(SYNC_INTERVAL_MINUTES).create();
}
