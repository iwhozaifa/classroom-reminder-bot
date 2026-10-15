import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_DELAY_MS,
  CATCH_UP_SYNC_FUNCTION,
  clearCatchUpSync,
  scheduleCatchUpSync,
  HEARTBEAT_HOUR_OF_DAY,
  HEARTBEAT_TRIGGER_FUNCTION,
  installAllTriggers,
  installHeartbeatTrigger,
  installRenewRegistrationsTrigger,
  installSyncTrigger,
  RENEW_REGISTRATIONS_HOUR_OF_DAY,
  RENEW_REGISTRATIONS_TRIGGER_FUNCTION,
  SYNC_SWEEP_HOURS,
  SYNC_TRIGGER_FUNCTION,
} from '../../src/triggers/onInstall.js';
import { FakeScriptApp } from '../fakes/FakeScriptApp.js';

describe('installSyncTrigger', () => {
  it('creates exactly one trigger for syncReminders, on the safety-net sweep interval', () => {
    const scriptApp = new FakeScriptApp();

    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
    expect(scriptApp.triggers[0]!.getHandlerFunction()).toBe(SYNC_TRIGGER_FUNCTION);
    expect(scriptApp.triggers[0]!.everyHoursValue).toBe(SYNC_SWEEP_HOURS);
  });

  it('is idempotent — running it twice still leaves exactly one trigger', () => {
    const scriptApp = new FakeScriptApp();

    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);
    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
  });

  it('never touches a trigger registered for a different handler function', () => {
    const scriptApp = new FakeScriptApp();
    scriptApp.newTrigger('someOtherHandler').timeBased().everyMinutes(60).create();

    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(2);
    expect(scriptApp.triggers.map((t) => t.getHandlerFunction())).toEqual(
      expect.arrayContaining(['someOtherHandler', SYNC_TRIGGER_FUNCTION]),
    );
  });
});

describe('installHeartbeatTrigger', () => {
  it('creates exactly one daily trigger for heartbeat, at the configured hour', () => {
    const scriptApp = new FakeScriptApp();

    installHeartbeatTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
    expect(scriptApp.triggers[0]!.getHandlerFunction()).toBe(HEARTBEAT_TRIGGER_FUNCTION);
    expect(scriptApp.triggers[0]!.everyDaysValue).toBe(1);
    expect(scriptApp.triggers[0]!.atHourValue).toBe(HEARTBEAT_HOUR_OF_DAY);
  });

  it('is idempotent — running it twice still leaves exactly one heartbeat trigger', () => {
    const scriptApp = new FakeScriptApp();

    installHeartbeatTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);
    installHeartbeatTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
  });

  it('never touches the sync trigger', () => {
    const scriptApp = new FakeScriptApp();
    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    installHeartbeatTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers.map((t) => t.getHandlerFunction())).toEqual(
      expect.arrayContaining([SYNC_TRIGGER_FUNCTION, HEARTBEAT_TRIGGER_FUNCTION]),
    );
    expect(scriptApp.triggers).toHaveLength(2);
  });
});

describe('installAllTriggers', () => {
  it('registers the sync, heartbeat and registration-renewal triggers in one call', () => {
    const scriptApp = new FakeScriptApp();

    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    const handlers = scriptApp.triggers.map((t) => t.getHandlerFunction());
    expect(handlers.sort()).toEqual([SYNC_TRIGGER_FUNCTION, HEARTBEAT_TRIGGER_FUNCTION, RENEW_REGISTRATIONS_TRIGGER_FUNCTION].sort());
  });

  it('stays idempotent when called repeatedly', () => {
    const scriptApp = new FakeScriptApp();

    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);
    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(3);
  });
});

describe('installRenewRegistrationsTrigger', () => {
  it('creates exactly one daily renewal trigger at the configured hour, idempotently', () => {
    const scriptApp = new FakeScriptApp();

    installRenewRegistrationsTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);
    installRenewRegistrationsTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
    expect(scriptApp.triggers[0]!.getHandlerFunction()).toBe(RENEW_REGISTRATIONS_TRIGGER_FUNCTION);
    expect(scriptApp.triggers[0]!.everyDaysValue).toBe(1);
    expect(scriptApp.triggers[0]!.atHourValue).toBe(RENEW_REGISTRATIONS_HOUR_OF_DAY);
  });
});

describe('scheduleCatchUpSync / clearCatchUpSync', () => {
  const asScriptApp = (fake: FakeScriptApp) => fake as unknown as GoogleAppsScript.Script.ScriptApp;

  it('creates one one-shot catch-up trigger, CATCH_UP_DELAY_MS out', () => {
    const scriptApp = new FakeScriptApp();

    expect(scheduleCatchUpSync(asScriptApp(scriptApp))).toBe(true);

    expect(scriptApp.triggers).toHaveLength(1);
    expect(scriptApp.triggers[0]!.getHandlerFunction()).toBe(CATCH_UP_SYNC_FUNCTION);
    expect(scriptApp.triggers[0]!.afterMsValue).toBe(CATCH_UP_DELAY_MS);
  });

  it('never stacks a second one while one is pending (a burst of lock-busy pushes)', () => {
    const scriptApp = new FakeScriptApp();
    installAllTriggers(asScriptApp(scriptApp));

    scheduleCatchUpSync(asScriptApp(scriptApp));
    expect(scheduleCatchUpSync(asScriptApp(scriptApp))).toBe(false);
    scheduleCatchUpSync(asScriptApp(scriptApp));

    expect(scriptApp.triggers.filter((t) => t.getHandlerFunction() === CATCH_UP_SYNC_FUNCTION)).toHaveLength(1);
  });

  it('clearCatchUpSync removes only the catch-up trigger, leaving the regular ones', () => {
    const scriptApp = new FakeScriptApp();
    installAllTriggers(asScriptApp(scriptApp));
    scheduleCatchUpSync(asScriptApp(scriptApp));

    clearCatchUpSync(asScriptApp(scriptApp));

    expect(scriptApp.triggers.map((t) => t.getHandlerFunction()).sort()).toEqual(
      [HEARTBEAT_TRIGGER_FUNCTION, RENEW_REGISTRATIONS_TRIGGER_FUNCTION, SYNC_TRIGGER_FUNCTION].sort(),
    );
    expect(scheduleCatchUpSync(asScriptApp(scriptApp))).toBe(true);
  });
});
