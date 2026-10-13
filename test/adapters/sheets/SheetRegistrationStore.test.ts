import { describe, expect, it } from 'vitest';
import { SheetRegistrationStore } from '../../../src/adapters/sheets/SheetRegistrationStore.js';
import { REGISTRATIONS_HEADERS } from '../../../src/adapters/sheets/schema.js';
import { FakeSheet } from '../../fakes/FakeSheet.js';

function makeStore(): { store: SheetRegistrationStore; sheet: FakeSheet } {
  const sheet = new FakeSheet('Registrations');
  sheet.getRange(1, 1, 1, REGISTRATIONS_HEADERS.length).setValues([[...REGISTRATIONS_HEADERS]]);
  return {
    store: new SheetRegistrationStore(sheet as unknown as GoogleAppsScript.Spreadsheet.Sheet),
    sheet,
  };
}

describe('SheetRegistrationStore', () => {
  it('loads nothing from a header-only tab', () => {
    expect(makeStore().store.load()).toEqual([]);
  });

  it('round-trips registrations through replaceAll/load', () => {
    const { store } = makeStore();
    const registrations = [
      { courseId: 'c1', registrationId: 'reg-1', expiresAt: 1_000 },
      { courseId: 'c2', registrationId: 'reg-2', expiresAt: 2_000 },
    ];

    store.replaceAll(registrations);

    expect(store.load()).toEqual(registrations);
  });

  it('replaceAll with fewer rows leaves no stale rows behind', () => {
    const { store } = makeStore();
    store.replaceAll([
      { courseId: 'c1', registrationId: 'reg-1', expiresAt: 1_000 },
      { courseId: 'c2', registrationId: 'reg-2', expiresAt: 2_000 },
    ]);

    store.replaceAll([{ courseId: 'c2', registrationId: 'reg-3', expiresAt: 3_000 }]);

    expect(store.load()).toEqual([{ courseId: 'c2', registrationId: 'reg-3', expiresAt: 3_000 }]);
  });
});
