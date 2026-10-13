import { describe, expect, it } from 'vitest';
import { SheetConfigStore } from '../../src/adapters/sheets/SheetConfigStore.js';
import { SheetLogger } from '../../src/adapters/sheets/SheetLogger.js';
import { CONFIG_HEADERS } from '../../src/adapters/sheets/schema.js';
import { MS_PER_DAY } from '../../src/core/time.js';
import type { Registration } from '../../src/core/types.js';
import type { PushRegistrar } from '../../src/ports/PushRegistrar.js';
import type { RegistrationStore } from '../../src/ports/RegistrationStore.js';
import { runRenewRegistrations } from '../../src/triggers/renewRegistrations.js';
import { FakeAlerter } from '../fakes/FakeAlerter.js';
import { FakeSheet } from '../fakes/FakeSheet.js';
import { FixedClock } from '../fakes/FixedClock.js';

const NOW = Date.UTC(2026, 0, 1);
const TOPIC = 'projects/p/topics/t';

class FakeRegistrar implements PushRegistrar {
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];
  failFor = new Set<string>();
  failUnregister = false;

  register(courseId: string, _topicName: string): Registration {
    if (this.failFor.has(courseId)) throw new Error(`cannot register ${courseId}`);
    this.registered.push(courseId);
    return { courseId, registrationId: `new-${courseId}`, expiresAt: NOW + 7 * MS_PER_DAY };
  }

  unregister(registrationId: string): void {
    if (this.failUnregister) throw new Error('delete failed');
    this.unregistered.push(registrationId);
  }
}

class InMemoryRegistrationStore implements RegistrationStore {
  constructor(public registrations: Registration[] = []) {}
  load(): Registration[] {
    return [...this.registrations];
  }
  replaceAll(registrations: Registration[]): void {
    this.registrations = [...registrations];
  }
}

function makeDeps(stored: Registration[] = []) {
  const configSheet = new FakeSheet('Config');
  configSheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([[...CONFIG_HEADERS]]);
  configSheet
    .getRange(2, 1, 1, 13)
    .setValues([['u1', 'One', 'UTC', 'c1,c2', 'slack', '', '', false, '', '', 7, 0, true]]);
  configSheet
    .getRange(3, 1, 1, 13)
    .setValues([['u2', 'Two', 'UTC', 'c9', 'slack', '', '', false, '', '', 7, 0, false]]);
  const clock = new FixedClock(NOW);
  const logSheet = new FakeSheet('Log');
  const registrar = new FakeRegistrar();
  const registrationStore = new InMemoryRegistrationStore(stored);
  const alerter = new FakeAlerter();
  return {
    deps: {
      clock,
      logger: new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock),
      configStore: new SheetConfigStore(
        configSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      ),
      registrar,
      registrationStore,
      alerter,
      topicName: TOPIC,
    },
    registrar,
    registrationStore,
    alerter,
    logSheet,
  };
}

describe('runRenewRegistrations', () => {
  it('registers every course of every active user (inactive users ignored) and persists them', () => {
    const { deps, registrar, registrationStore } = makeDeps();

    runRenewRegistrations(deps);

    expect(registrar.registered).toEqual(['c1', 'c2']);
    expect(registrationStore.registrations.map((r) => r.registrationId)).toEqual([
      'new-c1',
      'new-c2',
    ]);
  });

  it('renews an expiring registration and deletes the old one, keeps a fresh one, drops an orphan', () => {
    const fresh = { courseId: 'c1', registrationId: 'old-c1', expiresAt: NOW + 5 * MS_PER_DAY };
    const expiring = { courseId: 'c2', registrationId: 'old-c2', expiresAt: NOW + MS_PER_DAY };
    const orphan = { courseId: 'c9', registrationId: 'old-c9', expiresAt: NOW + 5 * MS_PER_DAY };
    const { deps, registrar, registrationStore } = makeDeps([fresh, expiring, orphan]);

    runRenewRegistrations(deps);

    expect(registrar.registered).toEqual(['c2']);
    expect(registrar.unregistered).toEqual(['old-c2', 'old-c9']);
    expect(registrationStore.registrations.map((r) => r.registrationId)).toEqual([
      'old-c1',
      'new-c2',
    ]);
  });

  it('keeps going past a failed create, alerts once naming the failed course, and persists the rest', () => {
    const { deps, registrar, registrationStore, alerter, logSheet } = makeDeps();
    registrar.failFor.add('c1');

    runRenewRegistrations(deps);

    expect(registrationStore.registrations.map((r) => r.courseId)).toEqual(['c2']);
    expect(alerter.errorAlerts).toHaveLength(1);
    expect(alerter.errorAlerts[0]).toContain('c1');
    expect(logSheet.rows.some((row) => row[1] === 'ERROR')).toBe(true);
  });

  it('logs but tolerates a failed delete, and still drops it from the store', () => {
    const orphan = { courseId: 'c9', registrationId: 'old-c9', expiresAt: NOW + 5 * MS_PER_DAY };
    const { deps, registrar, registrationStore, logSheet } = makeDeps([orphan]);
    registrar.failUnregister = true;

    runRenewRegistrations(deps);

    expect(registrationStore.registrations.some((r) => r.registrationId === 'old-c9')).toBe(false);
    expect(
      logSheet.rows.some((row) => row[1] === 'WARN' && String(row[3]).includes('delete')),
    ).toBe(true);
  });

  it('does not crash when the alert itself fails to send', () => {
    const { deps, registrar, alerter, logSheet } = makeDeps();
    registrar.failFor.add('c1');
    alerter.throwOnNextAlert();

    expect(() => runRenewRegistrations(deps)).not.toThrow();
    expect(logSheet.rows.some((row) => String(row[3]).includes('registration error alert'))).toBe(
      true,
    );
  });
});
