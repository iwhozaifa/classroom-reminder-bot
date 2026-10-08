import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_HOUR_OF_DAY,
  HEARTBEAT_TRIGGER_FUNCTION,
  installAllTriggers,
  installHeartbeatTrigger,
  installSyncTrigger,
  SYNC_INTERVAL_MINUTES,
  SYNC_TRIGGER_FUNCTION,
} from '../../src/triggers/onInstall.js';
import { FakeScriptApp } from '../fakes/FakeScriptApp.js';

describe('installSyncTrigger', () => {
  it('creates exactly one trigger for syncReminders, on the configured interval', () => {
    const scriptApp = new FakeScriptApp();

    installSyncTrigger(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(1);
    expect(scriptApp.triggers[0]!.getHandlerFunction()).toBe(SYNC_TRIGGER_FUNCTION);
    expect(scriptApp.triggers[0]!.everyMinutesValue).toBe(SYNC_INTERVAL_MINUTES);
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
  it('registers both the sync and heartbeat triggers in one call', () => {
    const scriptApp = new FakeScriptApp();

    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    const handlers = scriptApp.triggers.map((t) => t.getHandlerFunction());
    expect(handlers).toEqual(expect.arrayContaining([SYNC_TRIGGER_FUNCTION, HEARTBEAT_TRIGGER_FUNCTION]));
    expect(scriptApp.triggers).toHaveLength(2);
  });

  it('stays idempotent when called repeatedly', () => {
    const scriptApp = new FakeScriptApp();

    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);
    installAllTriggers(scriptApp as unknown as GoogleAppsScript.Script.ScriptApp);

    expect(scriptApp.triggers).toHaveLength(2);
  });
});
