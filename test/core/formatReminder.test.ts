import { describe, expect, it } from 'vitest';
import { cleanSubjectName, formatReminderText } from '../../src/core/formatReminder.js';

describe('cleanSubjectName', () => {
  it.each([
    ['BSCS-5A Software Engineering (Fall 2026)', 'Software Engineering'],
    ['CS101 - Data Structures', 'Data Structures'],
    ['SE-301: Operating Systems [Section B]', 'Operating Systems'],
    ['Linear Algebra - Section A', 'Linear Algebra'],
    ['Discrete Mathematics Spring 2027', 'Discrete Mathematics'],
    ['Database Systems | Fall 26', 'Database Systems'],
    ['BSAI-3B Calculus II (Fall 2026) (Morning)', 'Calculus II'],
    ['Physics 2', 'Physics 2'],
    ['AI Ethics', 'AI Ethics'],
    ['  Technical   Writing  ', 'Technical Writing'],
    ['Pakistan Studies', 'Pakistan Studies'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanSubjectName(raw)).toBe(expected);
  });

  it('falls back to the full name when stripping would leave nothing', () => {
    expect(cleanSubjectName('CS101 (Fall 2026)')).toBe('CS101 (Fall 2026)');
    expect(cleanSubjectName('BSCS-5A')).toBe('BSCS-5A');
  });
});

describe('formatReminderText', () => {
  // Thu 15 Oct 2026, 18:59 UTC = 11:59 PM in Asia/Karachi (UTC+5).
  const DUE = Date.UTC(2026, 9, 15, 18, 59);
  const HOUR = 3_600_000;

  it('shows subject, title, due time in the user zone, time left, and a Classroom link', () => {
    const text = formatReminderText({
      subject: 'Software Engineering',
      title: 'Lab 4: Binary Trees',
      dueAt: DUE,
      deliveredAt: DUE - 24 * HOUR,
      timezone: 'Asia/Karachi',
      link: 'https://classroom.google.com/c/abc/a/def/details',
    });
    expect(text).toBe(
      ':books: *Software Engineering* — Lab 4: Binary Trees\n' +
        'Due Thu 15 Oct, 11:59 PM (in 24h) · <https://classroom.google.com/c/abc/a/def/details|Open in Classroom>',
    );
  });

  it('computes time left from when the message lands, so a late catch-up send is still accurate', () => {
    const text = formatReminderText({
      subject: 'Calculus II',
      title: 'Quiz',
      dueAt: DUE,
      deliveredAt: DUE - (HOUR + 30 * 60_000),
      timezone: 'Asia/Karachi',
      link: null,
    });
    expect(text).toBe(':books: *Calculus II* — Quiz\nDue Thu 15 Oct, 11:59 PM (in 1h 30m)');
  });

  it('renders sub-hour and past-due remainders', () => {
    const base = { subject: 'X', title: 'T', dueAt: DUE, timezone: 'UTC', link: null };
    expect(formatReminderText({ ...base, deliveredAt: DUE - 45 * 60_000 })).toContain('(in 45m)');
    expect(formatReminderText({ ...base, deliveredAt: DUE })).toContain('(due now)');
  });

  it('says there is no due date for a daily reminder', () => {
    const text = formatReminderText({
      subject: 'Pakistan Studies',
      title: 'Reading reflection',
      dueAt: null,
      deliveredAt: DUE,
      timezone: 'Asia/Karachi',
      link: 'https://classroom.google.com/x',
    });
    expect(text).toBe(
      ':books: *Pakistan Studies* — Reading reflection\nNo due date — daily reminder · <https://classroom.google.com/x|Open in Classroom>',
    );
  });

  it('omits the subject when the course name is unknown, and escapes Slack control characters', () => {
    const text = formatReminderText({
      subject: null,
      title: 'Compare <A> & <B>',
      dueAt: null,
      deliveredAt: DUE,
      timezone: 'UTC',
      link: null,
    });
    expect(text).toBe(':books: Compare &lt;A&gt; &amp; &lt;B&gt;\nNo due date — daily reminder');
  });
});
