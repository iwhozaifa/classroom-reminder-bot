import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePushEnvelope } from '../../../src/adapters/pubsub/pubsubEnvelope.js';

const decode = (data: string): string => Buffer.from(data, 'base64').toString('utf8');
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64');

function fixtureBody(): string {
  return readFileSync(
    fileURLToPath(new URL('../../fixtures/pubsub/courseWorkChange.json', import.meta.url)),
    'utf8',
  );
}

function envelope(data: string, publishTime: unknown = '2026-01-01T00:00:00Z'): string {
  return JSON.stringify({ message: { data, publishTime } });
}

describe('parsePushEnvelope', () => {
  it('extracts course id, collection, event type and publish time from a real-shaped push', () => {
    expect(parsePushEnvelope(fixtureBody(), decode)).toEqual({
      courseId: 'course-1',
      collection: 'courses.courseWork',
      eventType: 'MODIFIED',
      publishedAt: Date.UTC(2026, 0, 1),
    });
  });

  it('handles a student-submission notification (same course-level resourceId)', () => {
    const data = encode({
      collection: 'courses.courseWork.studentSubmissions',
      eventType: 'MODIFIED',
      resourceId: { courseId: 'course-2', courseWorkId: 'cw-9', id: 'sub-1' },
    });

    expect(parsePushEnvelope(envelope(data), decode)).toMatchObject({ courseId: 'course-2' });
  });

  it.each([
    ['non-JSON body', 'not json'],
    ['no message', JSON.stringify({})],
    ['data not base64 JSON', envelope('!!!not-base64-json')],
    ['missing courseId', envelope(encode({ collection: 'courses.courseWork', resourceId: {} }))],
    ['missing publishTime', envelope(encode({ resourceId: { courseId: 'c' } }), null)],
    ['unparseable publishTime', envelope(encode({ resourceId: { courseId: 'c' } }), 'yesterday')],
  ])('returns null instead of throwing for %s', (_label, body) => {
    expect(parsePushEnvelope(body, decode)).toBeNull();
  });
});
