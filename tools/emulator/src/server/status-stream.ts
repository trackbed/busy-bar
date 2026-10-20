// The bar's status stream at /api/status/ws, as the firmware serves it
// (http_api/api_status_streaming.c and services/state_publisher): up to four
// WebSocket clients send `{"enable": true}` to subscribe and
// `{"send": "all"}` for a full snapshot, then receive protobuf `State`
// messages: input events, front frames at most every 100 ms, and a
// heartbeat every 991 ms.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Device } from '../device/device.ts';
import { encodeRle } from '../formats/rle.ts';
import {
  encodeFrameState,
  encodeHeartbeat,
  encodeInputState,
  encodeSnapshot,
  encodeTooManyClients,
} from './protobuf.ts';
import type { Message, WebSocketConnection } from './websocket.ts';
import { acceptUpgrade } from './websocket.ts';

export const MAX_CLIENTS = 4;
export const HEARTBEAT_MS = 991;
export const FRAME_INTERVAL_MS = 100;

interface Client {
  readonly connection: WebSocketConnection;
  enabled: boolean;
}

export class StatusStream {
  readonly #device: Device;
  /** The front display as B, G, R bytes. */
  readonly #front: () => Uint8Array;
  readonly #now: () => number;
  readonly #clients = new Set<Client>();
  readonly #heartbeat: ReturnType<typeof setInterval>;
  readonly #unsubscribe: () => void;
  #lastFrameAt = Number.NEGATIVE_INFINITY;
  #frameTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: {
    readonly device: Device;
    readonly front: () => Uint8Array;
    readonly now?: () => number;
  }) {
    this.#device = options.device;
    this.#front = options.front;
    this.#now = options.now ?? Date.now;
    this.#heartbeat = setInterval(() => {
      this.#broadcast(encodeHeartbeat(this.#now()));
    }, HEARTBEAT_MS);
    this.#unsubscribe = this.#device.on((event) => {
      if (event.type === 'input') {
        this.#broadcast(encodeInputState(event.event, this.#now()));
      } else if (event.type === 'settings') {
        this.#broadcast(this.#snapshot());
      }
    });
  }

  /** How many clients are connected, subscribed or not. */
  get size(): number {
    return this.#clients.size;
  }

  /** Take over an upgrade request for /api/status/ws. */
  accept(request: IncomingMessage, socket: Duplex): void {
    // Messages count only from a connection taken on as a client, never
    // from one turned away.
    const connection: WebSocketConnection | undefined = acceptUpgrade(
      request,
      socket,
      (message) => {
        for (const client of this.#clients) {
          if (client.connection === connection) {
            this.#receive(client, message);
          }
        }
      },
    );
    if (connection === undefined) {
      return;
    }
    if (this.#clients.size >= MAX_CLIENTS) {
      connection.send('binary', encodeTooManyClients(this.#now()));
      connection.close();
      return;
    }
    const client: Client = { connection, enabled: false };
    this.#clients.add(client);
    socket.on('close', () => {
      this.#clients.delete(client);
    });
  }

  /** The front display changed: send it, at most once per frame interval. */
  frameChanged(): void {
    if (this.#frameTimer !== undefined) {
      return;
    }
    const wait = this.#lastFrameAt + FRAME_INTERVAL_MS - this.#now();
    if (wait <= 0) {
      this.#sendFrame();
      return;
    }
    this.#frameTimer = setTimeout(() => {
      this.#frameTimer = undefined;
      this.#sendFrame();
    }, wait);
  }

  close(): void {
    clearInterval(this.#heartbeat);
    clearTimeout(this.#frameTimer);
    this.#unsubscribe();
    for (const client of this.#clients) {
      client.connection.close();
    }
    this.#clients.clear();
  }

  #receive(client: Client, message: Message): void {
    if (message.type !== 'text') {
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(message.data));
    } catch {
      return;
    }
    if (typeof body !== 'object' || body === null) {
      return;
    }
    if ('enable' in body && typeof body.enable === 'boolean') {
      client.enabled = body.enable;
    }
    if ('send' in body && body.send === 'all' && client.enabled) {
      client.connection.send('binary', this.#snapshot());
    }
  }

  #sendFrame(): void {
    this.#lastFrameAt = this.#now();
    this.#broadcast(
      encodeFrameState(encodeRle(this.#front(), 3), this.#lastFrameAt),
    );
  }

  #snapshot(): Uint8Array {
    const device = this.#device;
    return encodeSnapshot(
      {
        name: device.name,
        brightness: device.brightness,
        volume: device.volume,
      },
      encodeRle(this.#front(), 3),
      this.#now(),
    );
  }

  #broadcast(data: Uint8Array): void {
    for (const client of this.#clients) {
      if (client.enabled) {
        client.connection.send('binary', data);
      }
    }
  }
}
