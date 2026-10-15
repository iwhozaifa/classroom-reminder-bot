import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entryPoints } from '../src/main.js';
import {
  HEARTBEAT_TRIGGER_FUNCTION,
  RENEW_REGISTRATIONS_TRIGGER_FUNCTION,
  SYNC_TRIGGER_FUNCTION,
} from '../src/triggers/onInstall.js';
import { FakeScriptApp } from './fakes/FakeScriptApp.js';

/** Every function SETUP.md / README tell the user to run, every trigger handler, and the web app's doPost. */
const EXPECTED_ENTRY_POINTS = [
  'setupSheet',
  'listMyCourses',
  'installAllTriggers',
  'purgeOrphanScheduledMessages',
  'doPost',
  SYNC_TRIGGER_FUNCTION,
  HEARTBEAT_TRIGGER_FUNCTION,
  RENEW_REGISTRATIONS_TRIGGER_FUNCTION,
];

describe('scripts/build.mjs output (dist/Code.js)', () => {
  let dir: string;
  let code: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'classroom-bot-build-'));
    const outfile = join(dir, 'Code.js');
    execFileSync('node', ['scripts/build.mjs', '--outfile', outfile], { stdio: 'pipe' });
    code = readFileSync(outfile, 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('entryPoints in src/main.ts is exactly the documented set of callable functions', () => {
    expect(Object.keys(entryPoints).sort()).toEqual([...EXPECTED_ENTRY_POINTS].sort());
  });

  it('has no import/export — Apps Script has no module loader', () => {
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
  });

  // The Apps Script editor builds its Run dropdown by statically finding top-level
  // `function` declarations — anything inside the IIFE shows up as "No functions".
  it.each(EXPECTED_ENTRY_POINTS)('declares a top-level `function %s()` the editor can list', (name) => {
    expect(code).toMatch(new RegExp(`^function ${name}\\(`, 'm'));
  });

  it('the top-level stubs delegate into the real bundled code', () => {
    const scriptApp = new FakeScriptApp();
    const context = vm.createContext({ ScriptApp: scriptApp });
    vm.runInContext(code, context);

    vm.runInContext('installAllTriggers()', context);

    expect(scriptApp.triggers.map((t) => t.getHandlerFunction()).sort()).toEqual(
      [
        HEARTBEAT_TRIGGER_FUNCTION,
        SYNC_TRIGGER_FUNCTION,
        RENEW_REGISTRATIONS_TRIGGER_FUNCTION,
      ].sort(),
    );
  });

  // Pub/Sub only counts a 2xx as delivered; any ContentService response is a 302.
  it('doPost forwards its event, never throws, and returns nothing (so Apps Script answers 200)', () => {
    const errors: string[] = [];
    // No PropertiesService in the sandbox, so the handler fails — it must log, not throw.
    const context = vm.createContext({
      console: { error: (message: string) => errors.push(message) },
    });
    vm.runInContext(code, context);

    const result: unknown = vm.runInContext(
      'doPost({ parameter: {}, postData: { contents: "{}" } })',
      context,
    );

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
