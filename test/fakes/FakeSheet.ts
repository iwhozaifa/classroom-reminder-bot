// Minimal in-memory stand-in for the tiny slice of the Apps Script Spreadsheet/Sheet
// API this project actually calls (getRange/getValues/setValues/getLastRow/
// getLastColumn/appendRow/getSheetByName/insertSheet) — not a full implementation
// of the real (huge) ambient interface, so callers cast `as unknown as
// GoogleAppsScript.Spreadsheet.*` at the point of use. Kept here under test/fakes
// since later milestones' Sheet-touching tests can reuse it too.

export class FakeRange {
  constructor(
    private readonly sheet: FakeSheet,
    private readonly row: number,
    private readonly col: number,
    private readonly numRows: number,
    private readonly numCols: number,
  ) {}

  getValues(): unknown[][] {
    const result: unknown[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const sheetRow = this.sheet.rows[this.row - 1 + r] ?? [];
      const out: unknown[] = [];
      for (let c = 0; c < this.numCols; c++) out.push(sheetRow[this.col - 1 + c] ?? '');
      result.push(out);
    }
    return result;
  }

  setValues(values: unknown[][]): void {
    for (let r = 0; r < values.length; r++) {
      const idx = this.row - 1 + r;
      while (this.sheet.rows.length <= idx) this.sheet.rows.push([]);
      const target = this.sheet.rows[idx]!;
      const src = values[r]!;
      for (let c = 0; c < src.length; c++) target[this.col - 1 + c] = src[c];
    }
  }

  clearContent(): void {
    for (let r = 0; r < this.numRows; r++) {
      const idx = this.row - 1 + r;
      if (this.sheet.rows[idx]) this.sheet.rows[idx] = [];
    }
  }
}

export class FakeSheet {
  rows: unknown[][] = [];

  constructor(public readonly name: string) {}

  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getLastRow(): number {
    return this.rows.length;
  }

  getLastColumn(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  appendRow(row: unknown[]): void {
    this.rows.push([...row]);
  }
}

export class FakeSpreadsheet {
  private readonly sheets = new Map<string, FakeSheet>();

  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name: string): FakeSheet {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}
