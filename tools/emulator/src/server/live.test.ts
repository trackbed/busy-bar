import type { Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LiveEvent } from './live.ts';
import { LiveChannel } from './live.ts';

let server: Server | undefined;

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running !== undefined) {
    running.closeAllConnections();
    await new Promise<void>((resolve) => {
      running.close(() => {
        resolve();
      });
    });
  }
});

/** A server that hands every request to `open`; the URL to reach it. */
async function serve(
  open: (response: ServerResponse) => void,
): Promise<string> {
  const started = createServer((_request, response) => {
    open(response);
  });
  server = started;
  await new Promise<void>((resolve) => {
    started.listen(0, '127.0.0.1', resolve);
  });
  const address = started.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server has no port.');
  }
  return `http://127.0.0.1:${address.port}/`;
}

/** A page watching the stream: its response and the text it has read. */
async function watch(url: string) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (response.body === null) {
    throw new Error('The stream has no body.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  return {
    response,
    /** Read until `expected` has arrived; resolves with all text so far. */
    async until(expected: string): Promise<string> {
      while (!text.includes(expected)) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error(`The stream ended with ${JSON.stringify(text)}.`);
        }
        text += value;
      }
      return text;
    },
    /** Read to the end of the stream; resolves with all text. */
    async end(): Promise<string> {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return text;
        }
        text += value;
      }
    },
    leave(): void {
      controller.abort();
    },
  };
}

const STATE: LiveEvent = { type: 'state', data: { elements: 2 } };
const FRAME: LiveEvent = { type: 'frame', data: { front: 'AAAA' } };

describe('LiveChannel', () => {
  it('opens an event stream with the first events', async () => {
    const channel = new LiveChannel();
    const page = await watch(
      await serve((response) => {
        channel.open(response, [STATE, FRAME]);
      }),
    );

    expect(page.response.status).toBe(200);
    expect(Object.fromEntries(page.response.headers)).toMatchObject({
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    expect(await page.until('event: frame')).toBe(
      ': connected\n\n' +
        'event: state\ndata: {"elements":2}\n\n' +
        'event: frame\ndata: {"front":"AAAA"}\n\n',
    );
    expect(channel.size).toBe(1);
    channel.close();
  });

  it('sends each event to every page', async () => {
    const channel = new LiveChannel();
    const url = await serve((response) => {
      channel.open(response);
    });
    const first = await watch(url);
    const second = await watch(url);
    await first.until(': connected\n\n');
    await second.until(': connected\n\n');

    channel.send({ type: 'silence', data: null });

    expect(channel.size).toBe(2);
    expect(await first.until('null\n\n')).toBe(
      ': connected\n\nevent: silence\ndata: null\n\n',
    );
    expect(await second.until('null\n\n')).toBe(
      ': connected\n\nevent: silence\ndata: null\n\n',
    );
    channel.close();
  });

  it('forgets a page that goes away', async () => {
    const channel = new LiveChannel();
    const url = await serve((response) => {
      channel.open(response);
    });
    const leaving = await watch(url);
    const staying = await watch(url);
    await leaving.until(': connected');
    await staying.until(': connected');

    leaving.leave();

    await vi.waitFor(() => {
      expect(channel.size).toBe(1);
    });
    channel.send(STATE);
    expect(await staying.until('}\n\n')).toContain('event: state');
    channel.close();
  });

  it('ends every stream when it closes', async () => {
    const channel = new LiveChannel();
    const page = await watch(
      await serve((response) => {
        channel.open(response, [STATE]);
      }),
    );
    await page.until('event: state');

    channel.close();

    expect(channel.size).toBe(0);
    expect(await page.end()).toBe(
      ': connected\n\nevent: state\ndata: {"elements":2}\n\n',
    );
  });
});
