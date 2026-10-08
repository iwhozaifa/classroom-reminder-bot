import { describe, expect, it } from 'vitest';
import { SheetConfigStore } from '../../../src/adapters/sheets/SheetConfigStore.js';
import { FakeSheet } from '../../fakes/FakeSheet.js';
import { CONFIG_HEADERS } from '../../../src/adapters/sheets/schema.js';

function makeConfigSheet(rows: unknown[][]): FakeSheet {
  const sheet = new FakeSheet('Config');
  sheet.getRange(1, 1, 1, CONFIG_HEADERS.length).setValues([[...CONFIG_HEADERS]]);
  for (const [index, row] of rows.entries()) {
    sheet.getRange(2 + index, 1, 1, row.length).setValues([row]);
  }
  return sheet;
}

const ROW_U1 = ['u1', 'Student One', 'Asia/Karachi', 'course-1', 'slack', 'U999', 'D123', false, '', '', 7, 0, true];
const ROW_U2 = ['u2', 'Student Two', 'UTC', 'course-2', 'slack', 'U888', '', false, '', '', 7, 1, false];

describe('SheetConfigStore', () => {
  it('loads every row, schema is multi-row-ready even though v1 ships one user', () => {
    const sheet = makeConfigSheet([ROW_U1, ROW_U2]);
    const store = new SheetConfigStore(sheet as unknown as GoogleAppsScript.Spreadsheet.Sheet);

    const configs = store.loadAll();

    expect(configs).toHaveLength(2);
    expect(configs[0]).toMatchObject({ userId: 'u1', active: true });
    expect(configs[1]).toMatchObject({ userId: 'u2', active: false });
  });

  it('update() merges a patch into the matching row and leaves other rows alone', () => {
    const sheet = makeConfigSheet([ROW_U1, ROW_U2]);
    const store = new SheetConfigStore(sheet as unknown as GoogleAppsScript.Spreadsheet.Sheet);

    store.update('u1', { consecutiveFailureCount: 3 });

    const configs = store.loadAll();
    expect(configs[0]).toMatchObject({ userId: 'u1', consecutiveFailureCount: 3 });
    expect(configs[1]).toMatchObject({ userId: 'u2', consecutiveFailureCount: 1 }); // untouched
  });

  it('throws when asked to update a user id that has no Config row', () => {
    const sheet = makeConfigSheet([ROW_U1]);
    const store = new SheetConfigStore(sheet as unknown as GoogleAppsScript.Spreadsheet.Sheet);

    expect(() => store.update('does-not-exist', { active: false })).toThrowError(/does-not-exist/);
  });
});
