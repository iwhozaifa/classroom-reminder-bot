import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// appsscript.json lists oauthScopes explicitly, which turns OFF Apps Script's
// automatic scope detection — any API the bundle calls whose scope isn't listed
// fails at runtime with "Specified permissions are not sufficient to call ...".
// This maps what the shipped bundle calls to the scope that call needs.
const SCOPE = 'https://www.googleapis.com/auth/';
const REQUIRED_SCOPES: { usage: string; pattern: string; scope: string }[] = [
  { usage: 'ScriptApp trigger listing', pattern: '.getProjectTriggers(', scope: 'script.scriptapp' },
  { usage: 'ScriptApp trigger creation', pattern: '.newTrigger(', scope: 'script.scriptapp' },
  { usage: 'ScriptApp trigger deletion', pattern: '.deleteTrigger(', scope: 'script.scriptapp' },
  { usage: 'UrlFetchApp (Slack + Classroom REST)', pattern: 'UrlFetchApp.fetch(', scope: 'script.external_request' },
  { usage: 'SpreadsheetApp', pattern: 'SpreadsheetApp.', scope: 'spreadsheets' },
  { usage: 'Classroom courses.list', pattern: '/courses?', scope: 'classroom.courses.readonly' },
  { usage: 'Classroom courses.get', pattern: '?fields=id,name', scope: 'classroom.courses.readonly' },
  { usage: 'Classroom courseWork.list', pattern: '/courseWork?', scope: 'classroom.coursework.me.readonly' },
  {
    usage: 'Classroom studentSubmissions.list',
    pattern: '/studentSubmissions',
    scope: 'classroom.student-submissions.me.readonly',
  },
];

describe('appsscript.json oauthScopes cover every Apps Script API the bundle calls', () => {
  let dir: string;
  let code: string;
  let declaredScopes: string[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'classroom-bot-manifest-'));
    const outfile = join(dir, 'Code.js');
    execFileSync('node', ['scripts/build.mjs', '--outfile', outfile], { stdio: 'pipe' });
    code = readFileSync(outfile, 'utf8');
    declaredScopes = (JSON.parse(readFileSync('appsscript.json', 'utf8')) as { oauthScopes: string[] }).oauthScopes;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Guards the table itself: a stale or mistyped pattern would otherwise make the
  // scope check below pass silently by never matching.
  it.each(REQUIRED_SCOPES)('$usage is still detected in the bundle ($pattern)', ({ pattern }) => {
    expect(code).toContain(pattern);
  });

  it.each(REQUIRED_SCOPES)('$usage has its scope ($scope) declared', ({ scope }) => {
    expect(declaredScopes).toContain(`${SCOPE}${scope}`);
  });
});
