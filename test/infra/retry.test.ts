import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../../src/infra/retry.js';
import { FakeHttpClient, jsonResponse } from '../fakes/FakeHttpClient.js';

function retryHarness() {
  const sleeps: number[] = [];
  const sleep = (ms: number): void => void sleeps.push(ms);
  return { sleeps, sleep };
}

describe('fetchWithRetry', () => {
  it('returns immediately on a 2xx with zero retries', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, { ok: true }));
    const { sleep, sleeps } = retryHarness();

    const response = fetchWithRetry(client, { url: 'https://x', method: 'post' }, { maxAttempts: 4, baseDelayMs: 100, sleep });

    expect(response.statusCode).toBe(200);
    expect(client.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('retries a 429 once, then succeeds, sleeping once with exponential backoff', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(429, {}));
    client.enqueue(jsonResponse(200, { ok: true }));
    const { sleep, sleeps } = retryHarness();

    const response = fetchWithRetry(
      client,
      { url: 'https://x', method: 'post' },
      { maxAttempts: 4, baseDelayMs: 100, sleep, random: () => 0 },
    );

    expect(response.statusCode).toBe(200);
    expect(client.requests).toHaveLength(2);
    expect(sleeps).toEqual([100]); // baseDelayMs * 2^0 + 0 jitter
  });

  it('retries a 5xx the same way it retries a 429', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(503, {}));
    client.enqueue(jsonResponse(200, { ok: true }));
    const { sleep } = retryHarness();

    const response = fetchWithRetry(client, { url: 'https://x', method: 'post' }, { maxAttempts: 4, baseDelayMs: 50, sleep });

    expect(response.statusCode).toBe(200);
    expect(client.requests).toHaveLength(2);
  });

  it('never retries a non-retryable 4xx (e.g. 400) — returns it on the first attempt', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(400, { error: 'bad_request' }));
    const { sleep, sleeps } = retryHarness();

    const response = fetchWithRetry(client, { url: 'https://x', method: 'post' }, { maxAttempts: 4, baseDelayMs: 100, sleep });

    expect(response.statusCode).toBe(400);
    expect(client.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('honors a Retry-After header instead of computing an exponential delay', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(429, {}, { 'retry-after': '2' }));
    client.enqueue(jsonResponse(200, { ok: true }));
    const { sleep, sleeps } = retryHarness();

    fetchWithRetry(client, { url: 'https://x', method: 'post' }, { maxAttempts: 4, baseDelayMs: 100, sleep });

    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxAttempts and returns the last failing response rather than throwing', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(500, {}));
    client.enqueue(jsonResponse(500, {}));
    client.enqueue(jsonResponse(500, {}));
    const { sleep } = retryHarness();

    const response = fetchWithRetry(client, { url: 'https://x', method: 'post' }, { maxAttempts: 3, baseDelayMs: 10, sleep });

    expect(response.statusCode).toBe(500);
    expect(client.requests).toHaveLength(3);
  });

  it('honors a caller-supplied shouldRetry predicate instead of the status-code default', () => {
    const client = new FakeHttpClient();
    client.enqueue(jsonResponse(200, { ok: false, error: 'rate_limited_in_body' }));
    client.enqueue(jsonResponse(200, { ok: true }));
    const { sleep } = retryHarness();

    const response = fetchWithRetry(
      client,
      { url: 'https://x', method: 'post' },
      {
        maxAttempts: 4,
        baseDelayMs: 10,
        sleep,
        shouldRetry: (r) => JSON.parse(r.body).error === 'rate_limited_in_body',
      },
    );

    expect(response.statusCode).toBe(200);
    expect(client.requests).toHaveLength(2);
  });
});
