// Tiny batched read/write helpers shared by every tab — one getRange()/setValues()
// round trip per call, never cell-by-cell, which is the expensive part of the
// Sheets API. Row 1 is always the header; data starts at row 2.
type Sheet = GoogleAppsScript.Spreadsheet.Sheet;

const HEADER_ROWS = 1;

export function readDataRows(sheet: Sheet): unknown[][] {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= HEADER_ROWS || lastCol === 0) return [];
  return sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, lastCol).getValues();
}

/** Replaces the entire data body (everything below the header) in one shot. */
export function writeDataRows(sheet: Sheet, rows: unknown[][]): void {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > HEADER_ROWS && lastCol > 0) {
    sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, lastCol).clearContent();
  }
  if (rows.length > 0) {
    const width = rows[0]!.length;
    sheet.getRange(HEADER_ROWS + 1, 1, rows.length, width).setValues(rows);
  }
}
