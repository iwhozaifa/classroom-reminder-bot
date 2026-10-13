import type { Registration } from '../../core/types.js';
import type { RegistrationStore } from '../../ports/RegistrationStore.js';
import { readDataRows, writeDataRows } from './sheetIO.js';

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

/** Reads/writes the Registrations tab — column order is REGISTRATIONS_HEADERS. */
export class SheetRegistrationStore implements RegistrationStore {
  constructor(private readonly sheet: Sheet) {}

  load(): Registration[] {
    return readDataRows(this.sheet)
      .filter((row) => String(row[0]) !== '')
      .map((row) => ({
        courseId: String(row[0]),
        registrationId: String(row[1]),
        expiresAt: Number(row[2]),
      }));
  }

  replaceAll(registrations: Registration[]): void {
    writeDataRows(
      this.sheet,
      registrations.map((r) => [r.courseId, r.registrationId, r.expiresAt]),
    );
  }
}
