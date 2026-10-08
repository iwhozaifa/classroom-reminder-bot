import { describe, expect, it } from 'vitest';
import { applyConfigPatch, rowToConfig } from '../../../src/adapters/sheets/configMapping.js';

function row(overrides: Record<number, unknown> = {}): unknown[] {
  const base: unknown[] = [
    'u1', // user_id
    'Student One', // display_name
    'Asia/Karachi', // timezone
    'course-1,course-2', // course_ids
    'slack', // active_channels
    'U999', // slack_user_id
    'D123', // slack_dm_channel_id
    false, // quiet_hours_enabled
    '', // quiet_hours_start
    '', // quiet_hours_end
    7, // rolling_window_days
    0, // consecutive_failure_count
    true, // active
  ];
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
}

describe('rowToConfig', () => {
  it('parses a fully populated row', () => {
    expect(rowToConfig(row())).toEqual({
      userId: 'u1',
      displayName: 'Student One',
      timezone: 'Asia/Karachi',
      courseIds: ['course-1', 'course-2'],
      activeChannels: ['slack'],
      rollingWindowDays: 7,
      consecutiveFailureCount: 0,
      active: true,
    });
  });

  it('parses empty course_ids/active_channels cells as empty arrays, not [""]', () => {
    const config = rowToConfig(row({ 3: '', 4: '' }));
    expect(config.courseIds).toEqual([]);
    expect(config.activeChannels).toEqual([]);
  });

  it('trims whitespace around comma-separated list entries', () => {
    const config = rowToConfig(row({ 3: 'course-1, course-2 , course-3' }));
    expect(config.courseIds).toEqual(['course-1', 'course-2', 'course-3']);
  });

  it.each([
    ['TRUE', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('parses active cell %s as boolean %s', (cell, expected) => {
    expect(rowToConfig(row({ 12: cell })).active).toBe(expected);
  });

  it('defaults rolling_window_days and consecutive_failure_count when blank', () => {
    const config = rowToConfig(row({ 10: '', 11: '' }));
    expect(config.rollingWindowDays).toBe(7);
    expect(config.consecutiveFailureCount).toBe(0);
  });
});

describe('applyConfigPatch', () => {
  it('overwrites only the patched fields, leaving unmodeled columns (e.g. slack_user_id) untouched', () => {
    const original = row();
    const patched = applyConfigPatch(original, { consecutiveFailureCount: 2, active: false });

    expect(patched[11]).toBe(2);
    expect(patched[12]).toBe(false);
    expect(patched[5]).toBe('U999'); // slack_user_id untouched
    expect(patched[1]).toBe('Student One'); // display_name untouched
  });

  it('serializes courseIds/activeChannels back into comma-separated strings', () => {
    const patched = applyConfigPatch(row(), { courseIds: ['course-9'], activeChannels: ['slack', 'whatsapp'] });

    expect(patched[3]).toBe('course-9');
    expect(patched[4]).toBe('slack,whatsapp');
  });

  it('does not mutate the original row array', () => {
    const original = row();
    applyConfigPatch(original, { active: false });
    expect(original[12]).toBe(true);
  });
});
