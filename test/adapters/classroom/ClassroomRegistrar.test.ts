import { describe, expect, it } from 'vitest';
import { ClassroomApiError } from '../../../src/adapters/classroom/ClassroomApiError.js';
import { ClassroomRegistrar } from '../../../src/adapters/classroom/ClassroomRegistrar.js';
import { FakeHttpClient, jsonResponse } from '../../fakes/FakeHttpClient.js';
import { loadFixture } from '../../fixtures/loadFixture.js';

const TOPIC = 'projects/my-project/topics/classroom-push';

function makeRegistrar(client: FakeHttpClient): ClassroomRegistrar {
  return new ClassroomRegistrar({
    httpClient: client,
    oauthToken: 'test-oauth-token',
    retry: { maxAttempts: 2, baseDelayMs: 1, sleep: () => {} },
  });
}

describe('ClassroomRegistrar — register', () => {
  it('POSTs a COURSE_WORK_CHANGES registration for the course to the topic and maps the response', () => {
    const client = new FakeHttpClient();
    client.enqueue(
      jsonResponse(200, loadFixture('../fixtures/classroom/registrationCreated.json')),
    );

    const registration = makeRegistrar(client).register('course-1', TOPIC);

    expect(registration).toEqual({
      courseId: 'course-1',
      registrationId: 'reg-123',
      expiresAt: Date.UTC(2026, 0, 8),
    });
    const request = client.requests[0]!;
    expect(request.method).toBe('post');
    expect(request.url).toBe('https://classroom.googleapis.com/v1/registrations');
    expect(request.headers?.Authorization).toBe('Bearer test-oauth-token');
    expect(JSON.parse(request.payload!)).toEqual({
      feed: { feedType: 'COURSE_WORK_CHANGES', courseWorkChangesInfo: { courseId: 'course-1' } },
      cloudPubsubTopic: { topicName: TOPIC },
    });
  });

  it('throws a ClassroomApiError carrying the Classroom status on failure', () => {
    const client = new FakeHttpClient();
    client.enqueue(
      jsonResponse(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'nope' } }),
    );

    expect(() => makeRegistrar(client).register('course-1', TOPIC)).toThrowError(ClassroomApiError);
  });
});

describe('ClassroomRegistrar — unregister', () => {
  it('DELETEs the registration by id', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, {}));

    makeRegistrar(client).unregister('reg-123');

    expect(client.requests[0]).toMatchObject({
      method: 'delete',
      url: 'https://classroom.googleapis.com/v1/registrations/reg-123',
    });
  });

  it('accepts an empty success body', () => {
    const client = new FakeHttpClient();
    client.enqueue({ statusCode: 204, headers: {}, body: '' });

    expect(() => makeRegistrar(client).unregister('reg-123')).not.toThrow();
  });

  it('treats 404 (already expired) as success', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(404, loadFixture('../fixtures/classroom/errorNotFound.json')));

    expect(() => makeRegistrar(client).unregister('reg-gone')).not.toThrow();
  });

  it('throws on any other failure', () => {
    const client = new FakeHttpClient();
    client.enqueue(
      jsonResponse(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'nope' } }),
    );

    expect(() => makeRegistrar(client).unregister('reg-123')).toThrowError(ClassroomApiError);
  });
});
