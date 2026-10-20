import type { ServerResponse } from 'node:http';
import { createServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  ApiError,
  readBody,
  sendBytes,
  sendError,
  sendJson,
  sendOk,
} from './http.ts';

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

/** Answer one request with `handler` on a real server, then shut it down. */
async function call(handler: Handler, init?: RequestInit): Promise<Response> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The server has no port.');
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/`, init);
    // Read the body while the server is still up.
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

/** A request whose body is `chunks`, without a connection behind it. */
function message(chunks: readonly Uint8Array[]): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  for (const chunk of chunks) {
    request.push(chunk);
  }
  request.push(null);
  return request;
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('ApiError', () => {
  it('carries the status the bar answers with', () => {
    const error = new ApiError(404, 'Failed to play audio');

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Failed to play audio',
    });
  });
});

describe('readBody', () => {
  it('joins the chunks of a body', async () => {
    const body = await readBody(message([bytes('{"a"'), bytes(':1}')]), 64);

    expect(new TextDecoder().decode(body)).toBe('{"a":1}');
  });

  it('accepts a body of exactly the limit and an empty one', async () => {
    expect(await readBody(message([bytes('abcd')]), 4)).toStrictEqual(
      bytes('abcd'),
    );
    expect(await readBody(message([]), 4)).toHaveLength(0);
  });

  it('refuses a body over the limit with 413', async () => {
    const reading = readBody(message([bytes('ab'), bytes('cd')]), 3);

    await expect(reading).rejects.toThrow(ApiError);
    await expect(reading).rejects.toMatchObject({
      status: 413,
      message: 'Request body larger than 3 bytes.',
    });
  });

  it('skips chunks a decoder already turned into text', async () => {
    const request = message([bytes('text')]);
    request.setEncoding('utf8');

    expect(await readBody(request, 64)).toHaveLength(0);
  });

  it('lets the server answer 413 while the client is still sending', async () => {
    const response = await call(
      async (request, reply) => {
        try {
          await readBody(request, 8);
          sendOk(reply);
        } catch (error) {
          if (error instanceof ApiError) {
            sendError(reply, error);
          }
        }
      },
      { method: 'POST', body: new Uint8Array(64 * 1024) },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toStrictEqual({
      error: 'Request body larger than 8 bytes.',
    });
  });
});

describe('sendJson', () => {
  it("answers JSON with the API's CORS headers", async () => {
    const response = await call((_request, reply) => {
      sendJson(reply, 201, { name: 'Café' });
    });

    expect(response.status).toBe(201);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/json',
      // "é" takes two bytes.
      'content-length': '16',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
    });
    expect(await response.text()).toBe('{"name":"Café"}');
  });
});

describe('sendBytes', () => {
  it('sends text by its UTF-8 length, uncached', async () => {
    const response = await call((_request, reply) => {
      sendBytes(reply, 'text/plain; charset=utf-8', 'héllo');
    });

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'text/plain; charset=utf-8',
      'content-length': '6',
      'cache-control': 'no-store',
    });
    expect(await response.text()).toBe('héllo');
  });

  it('sends bytes as they are', async () => {
    const response = await call((_request, reply) => {
      sendBytes(reply, 'audio/wav', Uint8Array.from([0, 255, 7]));
    });

    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('content-length')).toBe('3');
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(
      Uint8Array.from([0, 255, 7]),
    );
  });
});

describe('sendOk and sendError', () => {
  it("answer with the firmware's success body", async () => {
    const response = await call((_request, reply) => {
      sendOk(reply);
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"result":"OK"}');
  });

  it('answer an error with only its message', async () => {
    const response = await call((_request, reply) => {
      sendError(reply, new ApiError(409, 'Not drawn due to low priority'));
    });

    expect(response.status).toBe(409);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toBe(
      '{"error":"Not drawn due to low priority"}',
    );
  });
});
