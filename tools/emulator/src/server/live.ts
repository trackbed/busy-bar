// Server-sent events for the emulator's page: frames, sounds, and device
// state as they change.

import type { ServerResponse } from 'node:http';

/** Keeps the open event streams and writes to all of them. */
export class LiveChannel {
  readonly #clients = new Set<ServerResponse>();

  /** How many pages are watching. */
  get size(): number {
    return this.#clients.size;
  }

  /** Turn `response` into an event stream until the page goes away. */
  open(response: ServerResponse, first: readonly LiveEvent[] = []): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    for (const event of first) {
      response.write(format(event));
    }
    this.#clients.add(response);
    response.on('close', () => {
      this.#clients.delete(response);
    });
  }

  send(event: LiveEvent): void {
    const text = format(event);
    for (const client of this.#clients) {
      client.write(text);
    }
  }

  close(): void {
    for (const client of this.#clients) {
      client.end();
    }
    this.#clients.clear();
  }
}

/** The events the page listens for. */
export type LiveEventType =
  | 'frame'
  | 'state'
  | 'sound'
  | 'silence'
  | 'led'
  | 'input';

export interface LiveEvent {
  readonly type: LiveEventType;
  readonly data: unknown;
}

function format(event: LiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
