import { describe, expect, it } from 'vitest';
import { ClassroomApiSource } from '../../../src/adapters/classroom/ClassroomApiSource.js';
import { SheetLogger } from '../../../src/adapters/sheets/SheetLogger.js';
import { FakeHttpClient, jsonResponse } from '../../fakes/FakeHttpClient.js';
import { FakeSheet } from '../../fakes/FakeSheet.js';
import { FixedClock } from '../../fakes/FixedClock.js';
import { loadFixture } from '../../fixtures/loadFixture.js';

function makeSource(client: FakeHttpClient, logSheet: FakeSheet = new FakeSheet('Log')) {
  const logger = new SheetLogger(logSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet, new FixedClock(0));
  const source = new ClassroomApiSource({
    httpClient: client,
    oauthToken: 'test-oauth-token',
    logger,
    retry: { maxAttempts: 2, baseDelayMs: 1, sleep: () => {} },
  });
  return { source, logSheet };
}

describe('ClassroomApiSource — listAssignments', () => {
  it('joins paginated courseWork with paginated studentSubmissions into Assignments, sending a bearer token', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage1.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage2.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/studentSubmissions.json')));
    const { source } = makeSource(client);

    const assignments = source.listAssignments('me', ['course-1']);

    // cw-2 is DRAFT (excluded); cw-3 has an unrecognized submission state (excluded, logged).
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ assignmentId: 'cw-1', courseId: 'course-1', submissionState: 'CREATED' });
    expect(client.requests.every((r) => r.headers?.Authorization === 'Bearer test-oauth-token')).toBe(true);
  });

  it('follows nextPageToken across multiple courseWork pages', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage1.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage2.json')));
    client.enqueue(jsonResponse(200, { studentSubmissions: [] }));
    const { source } = makeSource(client);

    source.listAssignments('me', ['course-1']);

    const courseWorkRequests = client.requests.filter((r) => r.url.includes('/courseWork?'));
    expect(courseWorkRequests).toHaveLength(2);
    expect(courseWorkRequests[1]!.url).toContain('pageToken=page2');
  });

  it('excludes DRAFT courseWork and logs + skips an unrecognized submission state instead of crashing', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage1.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage2.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/studentSubmissions.json')));
    const { source, logSheet } = makeSource(client);

    const assignments = source.listAssignments('me', ['course-1']);

    expect(assignments.some((a) => a.assignmentId === 'cw-2')).toBe(false);
    expect(assignments.some((a) => a.assignmentId === 'cw-3')).toBe(false);
    const warnRow = logSheet.rows.find((row) => row[1] === 'WARN');
    expect(warnRow).toBeDefined();
    expect(String(warnRow![4])).toContain('cw-3');
  });

  it('logs an ERROR and returns no assignments for a course that 404s, without throwing or affecting other courses', () => {
    const client = new FakeHttpClient();
    // course-bad: 404 on courseWork fetch.
    client.enqueue(jsonResponse(404, loadFixture('../fixtures/classroom/errorNotFound.json')));
    // course-1: succeeds normally.
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage1.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/courseWorkPage2.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/studentSubmissions.json')));
    const { source, logSheet } = makeSource(client);

    const assignments = source.listAssignments('me', ['course-bad', 'course-1']);

    expect(assignments.every((a) => a.courseId === 'course-1')).toBe(true);
    expect(assignments.length).toBeGreaterThan(0);
    const errorRow = logSheet.rows.find((row) => row[1] === 'ERROR');
    expect(errorRow).toBeDefined();
    expect(String(errorRow![4])).toContain('course-bad');
  });

  it('throws a ClassroomApiError carrying the Classroom status string when a non-2xx propagates unhandled', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(404, loadFixture('../fixtures/classroom/errorNotFound.json')));
    const { source } = makeSource(client);

    expect(() => source.listMyCourses()).toThrowError(expect.objectContaining({ classroomStatus: 'NOT_FOUND' }));
  });
});

describe('ClassroomApiSource — listMyCourses', () => {
  it('follows nextPageToken across multiple courses pages and returns id/name pairs', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/coursesPage1.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/classroom/coursesPage2.json')));
    const { source } = makeSource(client);

    const courses = source.listMyCourses();

    expect(courses).toEqual([
      { id: 'course-1', name: 'Intro to Biology' },
      { id: 'course-2', name: 'Algebra II' },
      { id: 'course-3', name: 'World History' },
    ]);
    expect(client.requests[0]!.url).toContain('studentId=me');
  });
});
