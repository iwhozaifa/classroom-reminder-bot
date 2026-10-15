// Runs the *shipped* dist/Code.js bundle in a vm sandbox with in-memory stand-ins for
// every Apps Script global it touches, so a test drives exactly what Apps Script
// would: top-level stub -> main.ts wiring -> triggers -> core -> adapters. Unlike the
// per-layer tests, nothing here is constructed by hand — Script Properties, the
// Sheet, Classroom and Slack are all reached through the real wiring.
//
// Values crossing into the sandbox are plain data or plain functions; nothing here
// throws into the bundle (a host-realm Error would fail the bundle's `instanceof
// Error` checks), so every simulated failure is an HTTP status, as in production.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { CONFIG_SHEET_NAME } from '../../src/adapters/sheets/schema.js';
import { FakeScriptApp } from '../fakes/FakeScriptApp.js';
import { FakeSpreadsheet } from '../fakes/FakeSheet.js';
import type { FakeSheet } from '../fakes/FakeSheet.js';

export const SHEET_ID = 'sheet-1';
export const DM_CHANNEL = 'D12345678';

let cachedBundle: string | null = null;

/** Builds dist/Code.js once per test file into a temp dir (never touches the real dist/). */
export function buildBundle(): string {
  if (cachedBundle !== null) return cachedBundle;
  const dir = mkdtempSync(join(tmpdir(), 'classroom-bot-e2e-'));
  try {
    const outfile = join(dir, 'Code.js');
    execFileSync('node', ['scripts/build.mjs', '--outfile', outfile], { stdio: 'pipe' });
    cachedBundle = readFileSync(outfile, 'utf8');
    return cachedBundle;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface FakeCourseWork {
  id: string;
  title: string;
  dueAt: number | null;
  submissionState: string;
  creationTime?: number;
}

interface FakeCourse {
  name: string;
  work: FakeCourseWork[];
}

export interface HttpCall {
  method: string;
  url: string;
  /** Slack form fields (empty for Classroom GETs). */
  params: Record<string, string>;
}

interface ScheduledSlackMessage {
  id: string;
  postAt: number;
  text: string;
}

/** One isolated Apps Script project: its properties, Sheet, triggers, and the outside world. */
export class AppsScriptWorld {
  readonly properties = new Map<string, string>();
  readonly spreadsheet = new FakeSpreadsheet();
  readonly scriptApp = new FakeScriptApp();
  readonly courses = new Map<string, FakeCourse>();
  readonly calls: HttpCall[] = [];
  readonly consoleErrors: string[] = [];
  readonly slackQueue = new Map<string, ScheduledSlackMessage>();
  readonly slackPosted: string[] = [];

  /** Simulates another execution holding the script lock. */
  lockBusy = false;
  /** courseId -> HTTP status to answer every Classroom read for that course with. */
  readonly classroomFailures = new Map<string, number>();
  /** Slack method -> error code to answer it with (`{ ok: false, error }`). */
  readonly slackFailures = new Map<string, string>();

  private nextSlackId = 1;
  private readonly context: vm.Context;

  constructor() {
    this.properties.set('SLACK_BOT_TOKEN', 'xoxb-test');
    this.properties.set('SLACK_USER_ID', 'U999');
    this.properties.set('SHEET_ID', SHEET_ID);

    this.context = vm.createContext(this.globals());
    vm.runInContext(buildBundle(), this.context);
    this.run('setupSheet');
  }

  /** Calls a top-level entry point exactly as a trigger or the editor's Run button would. */
  run(functionName: string, arg?: unknown): unknown {
    const fn = (this.context as Record<string, unknown>)[functionName];
    if (typeof fn !== 'function') throw new Error(`Bundle has no top-level function ${functionName}`);
    return (fn as (a?: unknown) => unknown)(arg);
  }

  addCourse(courseId: string, name: string, work: FakeCourseWork[] = []): void {
    this.courses.set(courseId, { name, work });
  }

  setWork(courseId: string, work: FakeCourseWork[]): void {
    this.courses.get(courseId)!.work = work;
  }

  /** One Config row in schema order (see CONFIG_HEADERS). */
  addUser(userId: string, courseIds: string[], timezone = 'Asia/Karachi'): void {
    this.sheet(CONFIG_SHEET_NAME).appendRow([
      userId, userId, timezone, courseIds.join(','), 'slack', '', '', false, '', '', 7, 0, true,
    ]);
  }

  sheet(name: string): FakeSheet {
    const sheet = this.spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error(`No tab ${name}`);
    return sheet;
  }

  /** Data rows (header excluded, cleared rows dropped) as header-keyed objects. */
  table(name: string): Record<string, unknown>[] {
    const [header, ...rows] = this.sheet(name).rows;
    return rows
      .filter((row) => row.some((cell) => cell !== '' && cell !== undefined))
      .map((row) => Object.fromEntries((header ?? []).map((h, i) => [String(h), row[i] ?? ''])));
  }

  logMessages(source?: string): string[] {
    return this.table('Log')
      .filter((row) => source === undefined || row.source === source)
      .map((row) => String(row.message));
  }

  callsTo(fragment: string): HttpCall[] {
    return this.calls.filter((call) => call.url.includes(fragment));
  }

  resetCalls(): void {
    this.calls.length = 0;
  }

  private globals(): Record<string, unknown> {
    const properties = this.properties;
    return {
      console: {
        error: (message: unknown) => this.consoleErrors.push(String(message)),
        log: () => {},
        warn: () => {},
        info: () => {},
      },
      Logger: { log: () => {} },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key: string) => properties.get(key) ?? null,
          setProperty: (key: string, value: string) => {
            properties.set(key, String(value));
          },
        }),
      },
      SpreadsheetApp: {
        openById: (id: string) => {
          if (id !== SHEET_ID) throw new Error(`Unknown spreadsheet ${id}`);
          return this.spreadsheet;
        },
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => !this.lockBusy,
          releaseLock: () => {},
        }),
      },
      ScriptApp: Object.assign(this.scriptApp, { getOAuthToken: () => 'oauth-test-token' }),
      Utilities: { sleep: () => {} },
      UrlFetchApp: {
        fetch: (url: string, options: { method?: string; payload?: string }) =>
          this.respond(url, (options.method ?? 'get').toLowerCase(), options.payload ?? ''),
      },
    };
  }

  private respond(url: string, method: string, payload: string) {
    const params = parseParams(url, payload);
    this.calls.push({ method, url, params });
    const [status, body] = url.startsWith('https://slack.com/api/')
      ? this.slack(url.slice('https://slack.com/api/'.length), params)
      : this.classroom(url);
    return {
      getResponseCode: () => status,
      getContentText: () => JSON.stringify(body),
      getHeaders: () => ({ 'Content-Type': 'application/json' }),
    };
  }

  private slack(method: string, params: Record<string, string>): [number, unknown] {
    const failure = this.slackFailures.get(method);
    if (failure !== undefined) return [200, { ok: false, error: failure }];

    switch (method) {
      case 'conversations.open':
        return [200, { ok: true, channel: { id: DM_CHANNEL } }];
      case 'chat.scheduleMessage': {
        const id = `Q${this.nextSlackId++}`;
        this.slackQueue.set(id, { id, postAt: Number(params.post_at), text: params.text ?? '' });
        return [200, { ok: true, scheduled_message_id: id, post_at: Number(params.post_at) }];
      }
      case 'chat.deleteScheduledMessage': {
        const deleted = this.slackQueue.delete(params.scheduled_message_id ?? '');
        return [200, deleted ? { ok: true } : { ok: false, error: 'invalid_scheduled_message_id' }];
      }
      case 'chat.postMessage':
        this.slackPosted.push(params.text ?? '');
        return [200, { ok: true, ts: `${this.nextSlackId++}.0001` }];
      case 'chat.scheduledMessages.list':
        return [
          200,
          {
            ok: true,
            scheduled_messages: [...this.slackQueue.values()].map((m) => ({ id: m.id, post_at: m.postAt })),
            response_metadata: { next_cursor: '' },
          },
        ];
      default:
        return [200, { ok: false, error: 'unknown_method' }];
    }
  }

  private classroom(url: string): [number, unknown] {
    const path = new URL(url).pathname.replace(/^\/v1/, '');

    const match = /^\/courses\/([^/]+)(\/courseWork(\/-\/studentSubmissions)?)?$/.exec(path);
    const course = match ? this.courses.get(match[1]!) : undefined;
    if (!match || !course) return [404, { error: { status: 'NOT_FOUND', message: `No ${path}` } }];

    const failure = this.classroomFailures.get(match[1]!);
    if (failure !== undefined) return [failure, { error: { status: 'INTERNAL', message: 'boom' } }];

    if (match[3]) {
      return [
        200,
        { studentSubmissions: course.work.map((w) => ({ courseWorkId: w.id, state: w.submissionState })) },
      ];
    }
    if (match[2]) {
      return [200, { courseWork: course.work.map((w) => toRawCourseWork(match[1]!, w)) }];
    }
    return [200, { id: match[1], name: course.name }];
  }
}

function toRawCourseWork(courseId: string, work: FakeCourseWork): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: work.id,
    title: work.title,
    state: 'PUBLISHED',
    creationTime: new Date(work.creationTime ?? Date.now() - 86_400_000).toISOString(),
    alternateLink: `https://classroom.google.com/c/${courseId}/a/${work.id}/details`,
  };
  if (work.dueAt !== null) {
    const due = new Date(work.dueAt);
    raw.dueDate = { year: due.getUTCFullYear(), month: due.getUTCMonth() + 1, day: due.getUTCDate() };
    raw.dueTime = { hours: due.getUTCHours(), minutes: due.getUTCMinutes() };
  }
  return raw;
}

/** Slack sends form bodies; the bot only ever GETs from Classroom. */
function parseParams(url: string, payload: string): Record<string, string> {
  if (payload === '' || !url.startsWith('https://slack.com/')) return {};
  return Object.fromEntries(new URLSearchParams(payload));
}
