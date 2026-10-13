import type { Instant } from '../../core/types.js';

/** What the push handler needs out of one Pub/Sub push delivery of a Classroom notification. */
export interface ClassroomPushEvent {
  courseId: string;
  /** e.g. 'courses.courseWork' or 'courses.courseWork.studentSubmissions'. */
  collection: string;
  eventType: string;
  publishedAt: Instant;
}

interface RawEnvelope {
  message?: { data?: unknown; publishTime?: unknown };
}

interface RawClassroomNotification {
  collection?: unknown;
  eventType?: unknown;
  resourceId?: { courseId?: unknown };
}

/**
 * Parses a Pub/Sub push body (`{ message: { data: <base64 JSON>, publishTime } }`)
 * into a ClassroomPushEvent, or null for anything malformed. Never throws: this is
 * attacker-reachable input arriving at an anonymous web app, so bad input is a
 * logged no-op, not a crash. Base64 decoding is injected (Utilities in production,
 * Buffer in tests) so this module stays free of Apps Script globals.
 */
export function parsePushEnvelope(
  body: string,
  decodeBase64: (data: string) => string,
): ClassroomPushEvent | null {
  try {
    const envelope = JSON.parse(body) as RawEnvelope;
    const data = envelope.message?.data;
    const publishTime = envelope.message?.publishTime;
    if (typeof data !== 'string' || typeof publishTime !== 'string') return null;

    const publishedAt = Date.parse(publishTime);
    if (Number.isNaN(publishedAt)) return null;

    const notification = JSON.parse(decodeBase64(data)) as RawClassroomNotification;
    const courseId = notification.resourceId?.courseId;
    if (typeof courseId !== 'string' || courseId === '') return null;

    return {
      courseId,
      collection: typeof notification.collection === 'string' ? notification.collection : '',
      eventType: typeof notification.eventType === 'string' ? notification.eventType : '',
      publishedAt,
    };
  } catch {
    return null;
  }
}
