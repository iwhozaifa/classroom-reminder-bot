import type { Assignment } from '../../core/types.js';
import type { ClassroomSource } from '../../ports/ClassroomSource.js';
import type { HttpClient, HttpResponse } from '../../infra/httpClient.js';
import { fetchWithRetry } from '../../infra/retry.js';
import type { SheetLogger } from '../sheets/SheetLogger.js';
import { ClassroomApiError } from './ClassroomApiError.js';
import { mapCourseWorkToAssignment, mapSubmissionState } from './classroomMapping.js';
import type { RawCourseWork, RawStudentSubmission } from './classroomMapping.js';

const API_BASE = 'https://classroom.googleapis.com/v1';
const PAGE_SIZE = 100;

export interface ClassroomRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => void;
}

export interface ClassroomApiSourceDeps {
  httpClient: HttpClient;
  /** `ScriptApp.getOAuthToken()` — injected so this class never touches Apps Script globals directly. */
  oauthToken: string;
  logger: SheetLogger;
  retry: ClassroomRetryOptions;
}

export interface CourseSummary {
  id: string;
  name: string;
}

/**
 * Reuses the HttpClient + fetchWithRetry seam from M5 (SlackNotifier) instead of the
 * `Classroom` advanced-service global, so the same fake-client fixture tests work here
 * too — see the plan's Testing Strategy section.
 */
export class ClassroomApiSource implements ClassroomSource {
  constructor(private readonly deps: ClassroomApiSourceDeps) {}

  listAssignments(_userId: string, courseIds: string[]): Assignment[] {
    return courseIds.flatMap((courseId) => this.listAssignmentsForCourse(courseId));
  }

  /** Paginated `courses.list` for courses the caller is enrolled in as a student — backs the "list my courses" helper. */
  listMyCourses(): CourseSummary[] {
    const courses: CourseSummary[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.get<{ courses?: { id: string; name: string }[]; nextPageToken?: string }>(
        `${API_BASE}/courses?studentId=me&courseStates=ACTIVE&pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      for (const course of page.courses ?? []) {
        courses.push({ id: course.id, name: course.name });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return courses;
  }

  private listAssignmentsForCourse(courseId: string): Assignment[] {
    let courseWork: RawCourseWork[];
    let submissions: RawStudentSubmission[];
    try {
      courseWork = this.listCourseWork(courseId);
      submissions = this.listStudentSubmissions(courseId);
    } catch (error) {
      // One unreachable/removed course must never take down reminders for the rest.
      this.deps.logger.log('ERROR', 'classroom', 'Failed to fetch coursework for course, skipping it this cycle', {
        courseId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const submissionByCourseWorkId = new Map(submissions.map((submission) => [submission.courseWorkId, submission]));
    const assignments: Assignment[] = [];
    for (const work of courseWork) {
      if (work.state !== 'PUBLISHED') continue;

      const rawState = submissionByCourseWorkId.get(work.id)?.state;
      const submissionState = mapSubmissionState(rawState);
      if (submissionState === null) {
        this.deps.logger.log('WARN', 'classroom', 'Skipping assignment with unrecognized or missing submission state', {
          courseId,
          assignmentId: work.id,
          rawState: rawState ?? null,
        });
        continue;
      }

      assignments.push(mapCourseWorkToAssignment(courseId, work, submissionState));
    }
    return assignments;
  }

  private listCourseWork(courseId: string): RawCourseWork[] {
    const items: RawCourseWork[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.get<{ courseWork?: RawCourseWork[]; nextPageToken?: string }>(
        `${API_BASE}/courses/${courseId}/courseWork?pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      items.push(...(page.courseWork ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /** `courseWorkId: '-'` lists submissions across every courseWork item in the course in one paginated call. */
  private listStudentSubmissions(courseId: string): RawStudentSubmission[] {
    const items: RawStudentSubmission[] = [];
    let pageToken: string | undefined;
    do {
      const page = this.get<{ studentSubmissions?: RawStudentSubmission[]; nextPageToken?: string }>(
        `${API_BASE}/courses/${courseId}/courseWork/-/studentSubmissions?userId=me&pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      items.push(...(page.studentSubmissions ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  private get<T>(url: string): T {
    const response = fetchWithRetry(
      this.deps.httpClient,
      {
        url,
        method: 'get',
        headers: { Authorization: `Bearer ${this.deps.oauthToken}` },
      },
      this.deps.retry,
    );
    return parseClassroomBody<T>(response);
  }
}

function parseClassroomBody<T>(response: HttpResponse): T {
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new ClassroomApiError(response.statusCode, null, `Classroom API returned a non-JSON body (HTTP ${response.statusCode})`);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const errorBody = body as { error?: { status?: string; message?: string } };
    const classroomStatus = errorBody.error?.status ?? null;
    const message = errorBody.error?.message ?? `HTTP ${response.statusCode}`;
    throw new ClassroomApiError(response.statusCode, classroomStatus, `Classroom API request failed: ${message}`);
  }
  return body as T;
}
