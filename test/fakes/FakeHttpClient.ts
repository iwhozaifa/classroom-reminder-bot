import type { HttpClient, HttpRequest, HttpResponse } from '../../src/infra/httpClient.js';

/** Returns one queued response per call, in order; records every request made. */
export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  private readonly queue: HttpResponse[] = [];

  enqueue(response: HttpResponse): void {
    this.queue.push(response);
  }

  fetch(request: HttpRequest): HttpResponse {
    this.requests.push(request);
    const response = this.queue.shift();
    if (!response) throw new Error('FakeHttpClient: no more queued responses');
    return response;
  }
}

export function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { statusCode, headers, body: JSON.stringify(body) };
}
