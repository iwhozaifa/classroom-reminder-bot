import type { ChannelId, Delivery, Instant } from '../../core/types.js';
import type { Notifier } from '../../ports/Notifier.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../../infra/httpClient.js';
import { fetchWithRetry } from '../../infra/retry.js';
import { SlackApiError, SLACK_INVALID_SCHEDULED_MESSAGE_ID, SLACK_RESTRICTED_TOO_MANY } from './SlackApiError.js';

export interface SlackRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => void;
}

export interface ScheduledSlackMessage {
  id: string;
  /** Epoch seconds, exactly as Slack reports it. */
  postAt: number;
}

export interface SlackNotifierDeps {
  httpClient: HttpClient;
  botToken: string;
  slackUserId: string;
  /** Pass the cached value from Script Properties; null forces a fresh conversations.open. */
  dmChannelId: string | null;
  retry: SlackRetryOptions;
}

/**
 * v1's only real Notifier. `schedule`/`cancel`/`sendNow` satisfy the capability-based
 * Notifier port; `sendHeartbeat`/`sendErrorAlert` are Slack-specific extras the
 * watchdog (M8) calls directly — they have no non-scheduling-channel equivalent, so
 * they deliberately live outside the port rather than forcing one on every channel.
 */
export class SlackNotifier implements Notifier {
  readonly channelId: ChannelId = 'slack';
  readonly supportsScheduling = true;

  private dmChannelId: string | null;

  constructor(private readonly deps: SlackNotifierDeps) {
    this.dmChannelId = deps.dmChannelId;
  }

  /** The orchestrator reads this after a cycle and persists it if it just got discovered. */
  getDmChannelId(): string | null {
    return this.dmChannelId;
  }

  schedule(_delivery: Delivery, text: string, fireAt: Instant): string {
    const channel = this.resolveDmChannel();
    const body = this.call('chat.scheduleMessage', {
      channel,
      text,
      post_at: String(Math.floor(fireAt / 1000)),
    });
    return String(body.scheduled_message_id);
  }

  /**
   * Idempotent: a message that already posted (or is inside Slack's no-delete window)
   * reports invalid_scheduled_message_id — it's no longer scheduled either way, which
   * is the outcome a cancel wants, so that one error counts as success.
   */
  cancel(externalMessageId: string): void {
    const channel = this.resolveDmChannel();
    try {
      this.call('chat.deleteScheduledMessage', { channel, scheduled_message_id: externalMessageId });
    } catch (error) {
      if (error instanceof SlackApiError && error.slackError === SLACK_INVALID_SCHEDULED_MESSAGE_ID) return;
      throw error;
    }
  }

  /** Every message still queued in the user's DM — backs the one-off orphan purge. */
  listScheduled(): ScheduledSlackMessage[] {
    const channel = this.resolveDmChannel();
    const messages: ScheduledSlackMessage[] = [];
    let cursor = '';
    do {
      const params: Record<string, string> = { channel, limit: '100' };
      if (cursor !== '') params.cursor = cursor;
      const body = this.call('chat.scheduledMessages.list', params);
      const page = (body.scheduled_messages ?? []) as { id: string; post_at: number }[];
      for (const message of page) {
        messages.push({ id: message.id, postAt: message.post_at });
      }
      cursor = (body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? '';
    } while (cursor !== '');
    return messages;
  }

  sendNow(_delivery: Delivery, text: string): string | null {
    const channel = this.resolveDmChannel();
    const body = this.call('chat.postMessage', { channel, text });
    return String(body.ts);
  }

  sendHeartbeat(text: string): void {
    const channel = this.resolveDmChannel();
    this.call('chat.postMessage', { channel, text });
  }

  sendErrorAlert(text: string): void {
    this.sendHeartbeat(`:warning: ${text}`);
  }

  private resolveDmChannel(): string {
    if (this.dmChannelId !== null) return this.dmChannelId;
    const body = this.call('conversations.open', { users: this.deps.slackUserId });
    const channel = body.channel as { id: string };
    this.dmChannelId = channel.id;
    return channel.id;
  }

  private call(method: string, params: Record<string, string>): Record<string, unknown> {
    const request: HttpRequest = {
      url: `https://slack.com/api/${method}`,
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      headers: { Authorization: `Bearer ${this.deps.botToken}` },
      payload: toFormBody(params),
    };

    const response = fetchWithRetry(this.deps.httpClient, request, {
      maxAttempts: this.deps.retry.maxAttempts,
      baseDelayMs: this.deps.retry.baseDelayMs,
      sleep: this.deps.retry.sleep,
      // Slack signals its own rate limit (distinct from HTTP 429) as ok:false in a
      // 200 body — retry.ts's default predicate only looks at statusCode, so it has
      // to be told about this one explicitly.
      shouldRetry: (r) => r.statusCode === 429 || r.statusCode >= 500 || isRestrictedTooMany(r),
    });

    return parseSlackBody(response, method);
  }
}

function isRestrictedTooMany(response: HttpResponse): boolean {
  try {
    const body = JSON.parse(response.body) as { error?: unknown };
    return body.error === SLACK_RESTRICTED_TOO_MANY;
  } catch {
    return false;
  }
}

function parseSlackBody(response: HttpResponse, method: string): Record<string, unknown> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    throw new SlackApiError('invalid_response', `Slack ${method} returned a non-JSON body (HTTP ${response.statusCode})`);
  }

  if (body.ok !== true) {
    const slackError = typeof body.error === 'string' ? body.error : 'unknown_error';
    throw new SlackApiError(slackError, `Slack ${method} failed: ${slackError}`);
  }

  return body;
}

function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
