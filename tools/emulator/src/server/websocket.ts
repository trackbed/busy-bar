// A minimal WebSocket server side (RFC 6455): enough for the bar's status
// stream, which busylib reads with the `websockets` package.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

type Opcode = 'continuation' | 'text' | 'binary' | 'close' | 'ping' | 'pong';

const OPCODES: Readonly<Record<number, Opcode>> = {
  0: 'continuation',
  1: 'text',
  2: 'binary',
  8: 'close',
  9: 'ping',
  10: 'pong',
};

const CODES: Readonly<Record<Exclude<Opcode, 'continuation'>, number>> = {
  text: 1,
  binary: 2,
  close: 8,
  ping: 9,
  pong: 10,
};

/** Frames from a client larger than this close the connection. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export interface Frame {
  readonly fin: boolean;
  readonly opcode: Opcode;
  readonly payload: Uint8Array;
}

/** A complete message from the client. */
export interface Message {
  readonly type: 'text' | 'binary';
  readonly data: Uint8Array;
}

/** The value for `Sec-WebSocket-Accept`, from the client's key. */
export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/**
 * Split `buffer` into the complete frames it holds, unmasking client frames.
 * Returns the bytes of an incomplete trailing frame as `rest`.
 */
export function parseFrames(buffer: Uint8Array): {
  readonly frames: Frame[];
  readonly rest: Uint8Array;
} {
  const frames: Frame[] = [];
  let offset = 0;
  for (;;) {
    const frame = parseFrame(buffer, offset);
    if (frame === undefined) {
      return { frames, rest: buffer.subarray(offset) };
    }
    frames.push(frame.frame);
    offset = frame.end;
  }
}

/** Encode one unmasked, final server frame. */
export function encodeFrame(
  opcode: Exclude<Opcode, 'continuation'>,
  payload: Uint8Array,
): Uint8Array {
  const length = payload.length;
  let header: Uint8Array;
  if (length < 126) {
    header = Uint8Array.from([0x80 | CODES[opcode], length]);
  } else if (length < 0x10000) {
    header = Uint8Array.from([
      0x80 | CODES[opcode],
      126,
      length >> 8,
      length & 0xff,
    ]);
  } else {
    header = new Uint8Array(10);
    header[0] = 0x80 | CODES[opcode];
    header[1] = 127;
    new DataView(header.buffer).setBigUint64(2, BigInt(length));
  }
  const frame = new Uint8Array(header.length + length);
  frame.set(header);
  frame.set(payload, header.length);
  return frame;
}

/** An open connection: answers pings, assembles messages, closes cleanly. */
export class WebSocketConnection {
  readonly #socket: Duplex;
  readonly #onMessage: (message: Message) => void;
  #pending: Uint8Array = new Uint8Array(0);
  #fragments: Uint8Array[] = [];
  #fragmentType: Message['type'] = 'binary';
  #closed = false;

  constructor(socket: Duplex, onMessage: (message: Message) => void) {
    this.#socket = socket;
    this.#onMessage = onMessage;
    socket.on('data', (chunk: Buffer) => {
      this.#receive(chunk);
    });
    socket.on('close', () => {
      this.#closed = true;
    });
    socket.on('error', () => {
      this.#closed = true;
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(type: Message['type'], data: Uint8Array): void {
    if (!this.#closed) {
      this.#socket.write(encodeFrame(type, data));
    }
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#socket.end(encodeFrame('close', Uint8Array.from([0x03, 0xe8])));
    }
  }

  #receive(chunk: Uint8Array): void {
    const buffer = new Uint8Array(this.#pending.length + chunk.length);
    buffer.set(this.#pending);
    buffer.set(chunk, this.#pending.length);
    let parsed: ReturnType<typeof parseFrames>;
    try {
      parsed = parseFrames(buffer);
    } catch {
      this.close();
      return;
    }
    this.#pending = parsed.rest;
    for (const frame of parsed.frames) {
      this.#handle(frame);
    }
  }

  #handle(frame: Frame): void {
    switch (frame.opcode) {
      case 'ping':
        if (!this.#closed) {
          this.#socket.write(encodeFrame('pong', frame.payload));
        }
        return;
      case 'pong':
        return;
      case 'close':
        this.close();
        return;
      case 'continuation':
        this.#fragments.push(frame.payload);
        break;
      case 'text':
      case 'binary':
        this.#fragments = [frame.payload];
        this.#fragmentType = frame.opcode;
        break;
    }
    if (frame.fin) {
      const data = join(this.#fragments);
      this.#fragments = [];
      this.#onMessage({ type: this.#fragmentType, data });
    }
  }
}

/**
 * Complete a WebSocket upgrade, or answer 400 and return undefined when the
 * request is not one.
 */
export function acceptUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  onMessage: (message: Message) => void,
): WebSocketConnection | undefined {
  const key = request.headers['sec-websocket-key'];
  const upgrade = request.headers.upgrade?.toLowerCase();
  if (typeof key !== 'string' || upgrade !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return undefined;
  }
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '',
      '',
    ].join('\r\n'),
  );
  return new WebSocketConnection(socket, onMessage);
}

function parseFrame(
  buffer: Uint8Array,
  offset: number,
): { readonly frame: Frame; readonly end: number } | undefined {
  if (buffer.length - offset < 2) {
    return undefined;
  }
  const first = buffer[offset] ?? 0;
  const second = buffer[offset + 1] ?? 0;
  const opcode = OPCODES[first & 0x0f];
  if (opcode === undefined) {
    throw new Error(`Unknown WebSocket opcode ${first & 0x0f}.`);
  }
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let at = offset + 2;
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  if (length === 126) {
    if (buffer.length - at < 2) {
      return undefined;
    }
    length = view.getUint16(at);
    at += 2;
  } else if (length === 127) {
    if (buffer.length - at < 8) {
      return undefined;
    }
    const long = view.getBigUint64(at);
    if (long > BigInt(MAX_FRAME_BYTES)) {
      throw new Error('WebSocket frame too large.');
    }
    length = Number(long);
    at += 8;
  }
  if (length > MAX_FRAME_BYTES) {
    throw new Error('WebSocket frame too large.');
  }
  const mask = masked ? buffer.subarray(at, at + 4) : undefined;
  if (masked) {
    at += 4;
  }
  if (buffer.length - at < length) {
    return undefined;
  }
  const payload = buffer.slice(at, at + length);
  if (mask !== undefined) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
    }
  }
  return {
    frame: { fin: (first & 0x80) !== 0, opcode, payload },
    end: at + length,
  };
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
