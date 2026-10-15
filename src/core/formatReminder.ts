import { MS_PER_HOUR } from './time.js';
import type { Instant } from './types.js';

const MS_PER_MINUTE = 60_000;

/** All-caps/digit code with at least one letter and one digit, e.g. `BSCS-5A`, `CS101`, `SE-301:`. */
const LEADING_CODE = /^([A-Z0-9][A-Z0-9\-_/.]*[A-Z0-9]):?$/;
const TRAILING_GROUP = /\s*[([][^()[\]]*[)\]]\s*$/;
const TRAILING_SECTION = /\s*[-–—|:,]?\s*\b(?:section|sec\.?)\s*[A-Z0-9-]+\s*$/i;
const TRAILING_TERM = /\s*[-–—|:,]?\s*\b(?:fall|spring|summer|winter|autumn)\s*'?\d{2,4}\s*$/i;
const EDGE_SEPARATORS = /^[\s\-–—|:,]+|[\s\-–—|:,]+$/g;

/**
 * Classroom class names usually carry section codes and term labels around the
 * actual subject ("BSCS-5A Software Engineering (Fall 2026)"). Strips that noise,
 * and falls back to the full name whenever stripping would leave nothing — a name
 * that is *only* a code is still more useful than an empty string.
 */
export function cleanSubjectName(name: string): string {
  const full = name.replace(/\s+/g, ' ').trim();
  let subject = full;

  const firstSpace = subject.indexOf(' ');
  if (firstSpace > 0) {
    const firstToken = subject.slice(0, firstSpace);
    if (LEADING_CODE.test(firstToken) && /\d/.test(firstToken) && /[A-Z]/.test(firstToken)) {
      subject = subject.slice(firstSpace + 1);
    }
  }
  subject = subject.replace(EDGE_SEPARATORS, '');

  let previous: string;
  do {
    previous = subject;
    subject = subject
      .replace(TRAILING_GROUP, '')
      .replace(TRAILING_SECTION, '')
      .replace(TRAILING_TERM, '')
      .replace(EDGE_SEPARATORS, '');
  } while (subject !== previous);

  return subject === '' ? full : subject;
}

export interface ReminderTextInput {
  /** Already-cleaned subject; null when the course name couldn't be fetched. */
  subject: string | null;
  title: string;
  dueAt: Instant | null;
  /** When the message will actually land — fireAt for a scheduled send, now for an immediate one. */
  deliveredAt: Instant;
  timezone: string;
  link: string | null;
}

/** Slack mrkdwn — everything needed to act on the reminder without opening Classroom. */
export function formatReminderText(input: ReminderTextInput): string {
  const { subject, title, dueAt, deliveredAt, timezone, link } = input;
  const header = subject === null ? `:books: ${escapeMrkdwn(title)}` : `:books: *${escapeMrkdwn(subject)}* — ${escapeMrkdwn(title)}`;

  const due =
    dueAt === null
      ? 'No due date — daily reminder'
      : `Due ${formatDueAt(dueAt, timezone)} (${formatTimeLeft(dueAt - deliveredAt)})`;
  const details = link === null ? due : `${due} · <${link}|Open in Classroom>`;

  return `${header}\n${details}`;
}

/** e.g. "Thu 16 Oct, 11:59 PM" in the user's own zone. */
function formatDueAt(dueAt: Instant, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(dueAt)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'due now';
  const totalMinutes = Math.round(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / (MS_PER_HOUR / MS_PER_MINUTE));
  const minutes = totalMinutes % (MS_PER_HOUR / MS_PER_MINUTE);
  if (hours === 0) return `in ${minutes}m`;
  return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
}

/** Slack treats only these three as control characters in message text. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
