// Small helpers over node:http: bodies, JSON answers, and the firmware's
// error shape.

import type { IncomingMessage, ServerResponse } from 'node:http';

/** A request the API refuses, answered as the firmware does. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Read the whole body, refusing anything larger than `limit` bytes. */
export async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Uint8Array)) {
      continue;
    }
    size += chunk.length;
    if (size > limit) {
      throw new ApiError(413, `Request body larger than ${limit} bytes.`);
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(data),
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  response.end(data);
}

export function sendBytes(
  response: ServerResponse,
  contentType: string,
  data: Uint8Array | string,
): void {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length':
      typeof data === 'string' ? Buffer.byteLength(data) : data.length,
    'cache-control': 'no-store',
  });
  response.end(data);
}

/** The firmware's success answer. */
export function sendOk(response: ServerResponse): void {
  sendJson(response, 200, { result: 'OK' });
}

/** The firmware's error answer: `{ error }`, without a code. */
export function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, { error: error.message });
}
