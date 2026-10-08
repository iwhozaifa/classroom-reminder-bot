import type { HttpClient, HttpRequest, HttpResponse } from './httpClient.js';

/** The one real HttpClient — every other adapter module stays Apps-Script-free. */
export class UrlFetchAppHttpClient implements HttpClient {
  fetch(request: HttpRequest): HttpResponse {
    const response = UrlFetchApp.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      contentType: request.contentType,
      payload: request.payload,
      muteHttpExceptions: true, // let callers inspect 4xx/5xx instead of throwing
    });

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(response.getHeaders())) {
      headers[name.toLowerCase()] = String(value);
    }

    return {
      statusCode: response.getResponseCode(),
      headers,
      body: response.getContentText(),
    };
  }
}
