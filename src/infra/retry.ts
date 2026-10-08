import type { HttpClient, HttpRequest, HttpResponse } from './httpClient.js';

export interface RetryOptions {
  /** Total attempts including the first — e.g. 4 means up to 3 retries. */
  maxAttempts: number;
  baseDelayMs: number;
  /** Injected so tests never actually wait; production passes Utilities.sleep. */
  sleep: (ms: number) => void;
  /** Defaults to "429 or 5xx". Callers can widen this (e.g. Slack's restricted_too_many). */
  shouldRetry?: (response: HttpResponse) => boolean;
  /** Injectable jitter source for deterministic tests; defaults to Math.random. */
  random?: () => number;
}

const defaultShouldRetry = (response: HttpResponse): boolean =>
  response.statusCode === 429 || response.statusCode >= 500;

/**
 * Retries a transport-level failure with exponential backoff + jitter, honoring a
 * Retry-After header when the server sends one. Never retries any other 4xx — those
 * are the caller's own bad request, not a transient condition. Returns the last
 * response as-is (even a failing one) once attempts run out; it's the caller's job
 * to turn a terminal failure into an error, since only it knows the response shape.
 */
export function fetchWithRetry(client: HttpClient, request: HttpRequest, options: RetryOptions): HttpResponse {
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  for (let attempt = 0; ; attempt++) {
    const response = client.fetch(request);
    const isLastAttempt = attempt >= options.maxAttempts - 1;
    if (!shouldRetry(response) || isLastAttempt) return response;
    options.sleep(retryDelayMs(response, attempt, options));
  }
}

function retryDelayMs(response: HttpResponse, attempt: number, options: RetryOptions): number {
  const retryAfterSeconds = Number(response.headers['retry-after']);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return retryAfterSeconds * 1000;

  const exponential = options.baseDelayMs * 2 ** attempt;
  const jitter = (options.random ?? Math.random)() * options.baseDelayMs;
  return exponential + jitter;
}
