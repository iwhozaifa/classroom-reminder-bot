import type { Registration } from '../../core/types.js';
import type { HttpClient } from '../../infra/httpClient.js';
import { fetchWithRetry } from '../../infra/retry.js';
import type { PushRegistrar } from '../../ports/PushRegistrar.js';
import { API_BASE, parseClassroomBody } from './ClassroomApiSource.js';
import type { ClassroomRetryOptions } from './ClassroomApiSource.js';

export interface ClassroomRegistrarDeps {
  httpClient: HttpClient;
  /** `ScriptApp.getOAuthToken()` — needs the classroom.push-notifications scope. */
  oauthToken: string;
  retry: ClassroomRetryOptions;
}

interface RawRegistration {
  registrationId: string;
  expiryTime: string;
}

/**
 * `registrations.create` / `registrations.delete` for the COURSE_WORK_CHANGES feed,
 * which covers both courseWork and studentSubmission changes in one course — so a
 * teacher editing a due date and the student turning work in both push.
 */
export class ClassroomRegistrar implements PushRegistrar {
  constructor(private readonly deps: ClassroomRegistrarDeps) {}

  register(courseId: string, topicName: string): Registration {
    const response = fetchWithRetry(
      this.deps.httpClient,
      {
        url: `${API_BASE}/registrations`,
        method: 'post',
        headers: this.authHeader(),
        contentType: 'application/json',
        payload: JSON.stringify({
          feed: { feedType: 'COURSE_WORK_CHANGES', courseWorkChangesInfo: { courseId } },
          cloudPubsubTopic: { topicName },
        }),
      },
      this.deps.retry,
    );
    const raw = parseClassroomBody<RawRegistration>(response);
    return { courseId, registrationId: raw.registrationId, expiresAt: Date.parse(raw.expiryTime) };
  }

  unregister(registrationId: string): void {
    const response = fetchWithRetry(
      this.deps.httpClient,
      {
        url: `${API_BASE}/registrations/${registrationId}`,
        method: 'delete',
        headers: this.authHeader(),
      },
      this.deps.retry,
    );
    if (response.statusCode === 404) return; // already expired/removed — the goal state anyway
    parseClassroomBody<unknown>(response.body === '' ? { ...response, body: '{}' } : response);
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.deps.oauthToken}` };
  }
}
