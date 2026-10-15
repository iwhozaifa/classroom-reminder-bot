// The injectable seam every HTTP-calling adapter (Slack now, Classroom in M6)
// depends on instead of UrlFetchApp directly — lets contract tests substitute a
// fake client returning hand-built fixture JSON, with zero network calls.

export interface HttpRequest {
  url: string;
  method: 'get' | 'post';
  headers?: Record<string, string>;
  contentType?: string;
  payload?: string;
}

export interface HttpResponse {
  statusCode: number;
  /** Lower-cased header names, so callers never have to guess Slack's casing. */
  headers: Record<string, string>;
  body: string;
}

export interface HttpClient {
  fetch(request: HttpRequest): HttpResponse;
}
