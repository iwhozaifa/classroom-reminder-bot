import { describe, expect, it } from 'vitest';
import { SlackNotifier } from '../../../src/adapters/slack/SlackNotifier.js';
import { SlackApiError } from '../../../src/adapters/slack/SlackApiError.js';
import type { Delivery } from '../../../src/core/types.js';
import { FakeHttpClient, jsonResponse } from '../../fakes/FakeHttpClient.js';
import { loadFixture } from '../../fixtures/loadFixture.js';

const delivery: Delivery = {
  userId: 'u1',
  assignmentId: 'a1',
  reminderType: '24h',
  fireAt: Date.UTC(2026, 0, 10, 12, 0),
  channel: 'slack',
  status: 'pending',
  externalMessageId: null,
};

function makeNotifier(client: FakeHttpClient, dmChannelId: string | null = 'D12345678') {
  return new SlackNotifier({
    httpClient: client,
    botToken: 'xoxb-test-token',
    slackUserId: 'U999',
    dmChannelId,
    retry: { maxAttempts: 4, baseDelayMs: 10, sleep: () => {} },
  });
}

describe('SlackNotifier — schedule', () => {
  it('schedules a reminder with the correct channel, text, and post_at (seconds, not ms)', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/scheduleMessageSuccess.json')));
    const notifier = makeNotifier(client);

    const id = notifier.schedule(delivery, 'Reminder: a1 (24h)', delivery.fireAt);

    expect(id).toBe('Q1298393284');
    expect(client.requests).toHaveLength(1);
    const body = client.requests[0]!.payload!;
    expect(body).toContain('channel=D12345678');
    expect(body).toContain(`post_at=${Math.floor(delivery.fireAt / 1000)}`);
    expect(body).toContain(encodeURIComponent('Reminder: a1 (24h)'));
    expect(client.requests[0]!.headers?.Authorization).toBe('Bearer xoxb-test-token');
  });

  it('resolves the DM channel via conversations.open on first use when none is cached', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/conversationsOpenSuccess.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/scheduleMessageSuccess.json')));
    const notifier = makeNotifier(client, null);

    notifier.schedule(delivery, 'text', delivery.fireAt);

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]!.url).toContain('conversations.open');
    expect(client.requests[0]!.payload).toContain('users=U999');
    expect(notifier.getDmChannelId()).toBe('D12345678');
  });

  it('never calls conversations.open again once the channel id is cached', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/scheduleMessageSuccess.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/scheduleMessageSuccess.json')));
    const notifier = makeNotifier(client); // already has a cached dmChannelId

    notifier.schedule(delivery, 'text', delivery.fireAt);
    notifier.schedule(delivery, 'text', delivery.fireAt);

    expect(client.requests.every((r) => !r.url.includes('conversations.open'))).toBe(true);
  });

  it('throws a named SlackApiError on time_too_far, without retrying', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/timeTooFar.json')));
    const notifier = makeNotifier(client);

    expect(() => notifier.schedule(delivery, 'text', delivery.fireAt)).toThrowError(SlackApiError);
    expect(client.requests).toHaveLength(1); // no retry — the body error is permanent, not transient
  });

  it('throws a named SlackApiError on time_in_past', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/timeInPast.json')));
    const notifier = makeNotifier(client);

    expect(() => notifier.schedule(delivery, 'text', delivery.fireAt)).toThrowError(
      expect.objectContaining({ slackError: 'time_in_past' }),
    );
  });

  it('retries automatically on restricted_too_many (Slack-level rate limit, not an HTTP 429) and then succeeds', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/restrictedTooMany.json')));
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/scheduleMessageSuccess.json')));
    const notifier = makeNotifier(client);

    const id = notifier.schedule(delivery, 'text', delivery.fireAt);

    expect(id).toBe('Q1298393284');
    expect(client.requests).toHaveLength(2);
  });

  it('throws a SlackApiError on a non-JSON body instead of crashing on JSON.parse', () => {
    const client = new FakeHttpClient();
    client.enqueue({ statusCode: 200, headers: {}, body: '<html>not json</html>' });
    const notifier = makeNotifier(client);

    expect(() => notifier.schedule(delivery, 'text', delivery.fireAt)).toThrowError(
      expect.objectContaining({ slackError: 'invalid_response' }),
    );
  });
});

describe('SlackNotifier — cancel', () => {
  it('cancels a scheduled message by id against the resolved channel', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/deleteScheduledMessageSuccess.json')));
    const notifier = makeNotifier(client);

    notifier.cancel('Q1298393284');

    expect(client.requests[0]!.url).toContain('chat.deleteScheduledMessage');
    expect(client.requests[0]!.payload).toContain('scheduled_message_id=Q1298393284');
    expect(client.requests[0]!.payload).toContain('channel=D12345678');
  });
});

describe('SlackNotifier — sendNow / heartbeat / alert', () => {
  it('sendNow posts the message immediately and returns the message ts', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/postMessageSuccess.json')));
    const notifier = makeNotifier(client);

    const id = notifier.sendNow(delivery, 'text');

    expect(id).toBe('1737590401.000200');
    expect(client.requests[0]!.url).toContain('chat.postMessage');
  });

  it('sendErrorAlert prefixes the message and reuses chat.postMessage, same as sendHeartbeat', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, loadFixture('../fixtures/slack/postMessageSuccess.json')));
    const notifier = makeNotifier(client);

    notifier.sendErrorAlert('sync has failed twice');

    expect(client.requests[0]!.url).toContain('chat.postMessage');
    expect(client.requests[0]!.payload).toContain(encodeURIComponent(':warning: sync has failed twice'));
  });
});
