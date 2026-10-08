/**
 * Slack's web API returns HTTP 200 with `{ ok: false, error: "<code>" }` for a
 * business-logic failure — never an HTTP error status for these — so they have to
 * be surfaced as a typed error rather than just an HTTP status check.
 */
export class SlackApiError extends Error {
  constructor(
    public readonly slackError: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackApiError';
  }
}

// Named because callers need to recognize them, not because they're parsed any
// differently — see M0's findings: scheduleMessage rejects >120 days out or any
// past timestamp, and allows at most 30 scheduled messages per channel per 5 min.
export const SLACK_TIME_TOO_FAR = 'time_too_far';
export const SLACK_TIME_IN_PAST = 'time_in_past';
export const SLACK_RESTRICTED_TOO_MANY = 'restricted_too_many';
