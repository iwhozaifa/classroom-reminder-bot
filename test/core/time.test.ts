import { describe, expect, it } from 'vitest';
import { resolveDueInstant } from '../../src/core/time.js';

function wallClockParts(instant: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(instant)) if (p.type !== 'literal') parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

describe('resolveDueInstant', () => {
  it('returns null when there is no due date at all', () => {
    expect(resolveDueInstant(null, null, 'Asia/Karachi')).toBeNull();
  });

  it('uses an explicit dueTime as-is — it is already UTC, so the timezone is irrelevant', () => {
    const instant = resolveDueInstant({ year: 2026, month: 3, day: 10 }, { hours: 14, minutes: 30 }, 'Asia/Karachi');
    expect(instant).toBe(Date.UTC(2026, 2, 10, 14, 30));
  });

  it('ignores the timezone for an explicit dueTime even when the zone would shift the date', () => {
    const karachi = resolveDueInstant({ year: 2026, month: 3, day: 10 }, { hours: 14, minutes: 30 }, 'Asia/Karachi');
    const newYork = resolveDueInstant({ year: 2026, month: 3, day: 10 }, { hours: 14, minutes: 30 }, 'America/New_York');
    expect(karachi).toBe(newYork);
  });

  it('defaults to 23:59 in the configured timezone when dueTime is absent (no-DST zone)', () => {
    const instant = resolveDueInstant({ year: 2026, month: 1, day: 15 }, null, 'Asia/Karachi');
    expect(wallClockParts(instant!, 'Asia/Karachi')).toEqual({ year: 2026, month: 1, day: 15, hour: 23, minute: 59 });
  });

  it('defaults to 23:59 local correctly in winter (EST, UTC-5) for a DST-observing zone', () => {
    const instant = resolveDueInstant({ year: 2026, month: 1, day: 15 }, null, 'America/New_York');
    expect(wallClockParts(instant!, 'America/New_York')).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      hour: 23,
      minute: 59,
    });
  });

  it('defaults to 23:59 local correctly in summer (EDT, UTC-4) for the same DST-observing zone', () => {
    const instant = resolveDueInstant({ year: 2026, month: 7, day: 15 }, null, 'America/New_York');
    expect(wallClockParts(instant!, 'America/New_York')).toEqual({
      year: 2026,
      month: 7,
      day: 15,
      hour: 23,
      minute: 59,
    });
    // Proves this is real instant math, not naive local-clock subtraction: the two DST test
    // cases above must land on different UTC offsets even though both ask for the same 23:59.
    const winter = resolveDueInstant({ year: 2026, month: 1, day: 15 }, null, 'America/New_York')!;
    expect(instant! - winter).not.toBe(Date.UTC(2026, 6, 15) - Date.UTC(2026, 0, 15));
  });
});
