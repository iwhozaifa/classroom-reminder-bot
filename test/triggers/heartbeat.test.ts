import { describe, expect, it } from 'vitest';
import { runHeartbeat } from '../../src/triggers/heartbeat.js';
import { SheetLogger } from '../../src/adapters/sheets/SheetLogger.js';
import { LOG_HEADERS } from '../../src/adapters/sheets/schema.js';
import { MS_PER_DAY } from '../../src/core/time.js';
import { FakeAlerter } from '../fakes/FakeAlerter.js';
import { FakeSheet } from '../fakes/FakeSheet.js';
import { FixedClock } from '../fakes/FixedClock.js';

const NOW = Date.UTC(2026, 2, 1); // 2026-03-01

function makeLogSheet(): FakeSheet {
  const sheet = new FakeSheet('Log');
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([[...LOG_HEADERS]]);
  return sheet;
}

function rowAt(daysAgo: number): unknown[] {
  const timestamp = new Date(NOW - daysAgo * MS_PER_DAY).toISOString();
  return [timestamp, 'INFO', 'sync', 'did a thing', ''];
}

describe('runHeartbeat', () => {
  it('sends a heartbeat message and logs an INFO entry for the run itself', () => {
    const logSheet = makeLogSheet();
    const clock = new FixedClock(NOW);
    const logger = new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock);
    const sender = new FakeAlerter();

    runHeartbeat({ clock, logger, sender });

    expect(sender.heartbeats).toHaveLength(1);
    expect(sender.heartbeats[0]).toContain('heartbeat');
    const infoRow = logSheet.rows.find((row) => row[1] === 'INFO' && row[2] === 'heartbeat');
    expect(infoRow).toBeDefined();
  });

  it('prunes Log rows older than the retention window but keeps everything newer', () => {
    const logSheet = makeLogSheet();
    logSheet.appendRow(rowAt(40)); // older than 30d default — pruned
    logSheet.appendRow(rowAt(31)); // older than 30d default — pruned
    logSheet.appendRow(rowAt(10)); // kept
    const clock = new FixedClock(NOW);
    const logger = new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock);
    const sender = new FakeAlerter();

    runHeartbeat({ clock, logger, sender });

    // 3 original rows - 2 pruned + the heartbeat's own fresh INFO row = 2 remaining.
    const remainingSyncRows = logSheet.rows.filter((row) => row[2] === 'sync');
    expect(remainingSyncRows).toHaveLength(1);
    expect(sender.heartbeats[0]).toContain('Pruned 2 log row');
  });

  it('honors a custom retentionDays override', () => {
    const logSheet = makeLogSheet();
    logSheet.appendRow(rowAt(5));
    const clock = new FixedClock(NOW);
    const logger = new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, clock);
    const sender = new FakeAlerter();

    runHeartbeat({ clock, logger, sender, retentionDays: 1 });

    const remainingSyncRows = logSheet.rows.filter((row) => row[2] === 'sync');
    expect(remainingSyncRows).toHaveLength(0);
  });
});
