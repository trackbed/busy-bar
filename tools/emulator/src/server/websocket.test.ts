import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { Message } from './websocket.ts';
import {
  acceptKey,
  encodeFrame,
  MAX_FRAME_BYTES,
  parseFrames,
  WebSocketConnection,
} from './websocket.ts';

/** A masked client frame, as a browser or the websockets package sends it. */
function clientFrame(
  opcode: number,
  payload: Uint8Array,
  { fin = true } = {},
): Uint8Array {
  const mask = Uint8Array.from([1, 2, 3, 4]);
  const length = payload.length;
  const header =
    length < 126
      ? Uint8Array.from([(fin ? 0x80 : 0) | opcode, 0x80 | length])
      : Uint8Array.from([
          (fin ? 0x80 : 0) | opcode,
          0x80 | 126,
          length >> 8,
          length & 0xff,
        ]);
  const out = new Uint8Array(header.length + 4 + length);
  out.set(header);
  out.set(mask, header.length);
  payload.forEach((byte, i) => {
    out[header.length + 4 + i] = byte ^ (mask[i % 4] ?? 0);
  });
  return out;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('acceptKey', () => {
  it('matches the example in RFC 6455', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe(
      's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
    );
  });
});

describe('encodeFrame and parseFrames', () => {
  it.each([5, 300, 70_000])('round-trips a %d-byte payload', (size) => {
    const payload = Uint8Array.from({ length: size }, (_, i) => i & 0xff);

    const { frames, rest } = parseFrames(encodeFrame('binary', payload));

    expect(frames).toStrictEqual([{ fin: true, opcode: 'binary', payload }]);
    expect(rest).toHaveLength(0);
  });

  it('unmasks client frames and keeps an incomplete one for later', () => {
    const first = clientFrame(1, text('{"enable": true}'));
    const second = clientFrame(2, Uint8Array.from([9, 9, 9]));
    const buffer = new Uint8Array(first.length + 3);
    buffer.set(first);
    buffer.set(second.subarray(0, 3), first.length);

    const { frames, rest } = parseFrames(buffer);

    expect(frames).toStrictEqual([
      { fin: true, opcode: 'text', payload: text('{"enable": true}') },
    ]);
    expect(rest).toStrictEqual(second.subarray(0, 3));
  });

  it.each([
    [Uint8Array.from([0x81]), 0],
    [Uint8Array.from([0x82, 126, 1]), 0],
    [Uint8Array.from([0x82, 127, 0, 0]), 0],
  ])('waits for more bytes (%#)', (bytes, count) => {
    expect(parseFrames(bytes).frames).toHaveLength(count);
  });

  it('rejects unknown opcodes and oversized frames', () => {
    expect(() => parseFrames(Uint8Array.from([0x83, 0]))).toThrow(
      'Unknown WebSocket opcode 3',
    );
    const huge = new Uint8Array(10);
    huge[0] = 0x82;
    huge[1] = 127;
    new DataView(huge.buffer).setBigUint64(2, BigInt(MAX_FRAME_BYTES + 1));
    expect(() => parseFrames(huge)).toThrow('too large');
    const big = Uint8Array.from([0x82, 126, 0xff, 0xff]);
    expect(parseFrames(big).frames).toHaveLength(0);
  });
});

describe('WebSocketConnection', () => {
  function connect() {
    const written: Uint8Array[] = [];
    const socket = new Duplex({
      read() {
        // Incoming bytes are pushed by `receive`.
      },
      write(chunk: Uint8Array, _encoding, callback) {
        written.push(Uint8Array.from(chunk));
        callback();
      },
    });
    const messages: Message[] = [];
    const connection = new WebSocketConnection(socket, (message) => {
      messages.push(message);
    });
    const receive = (bytes: Uint8Array): void => {
      socket.emit('data', Buffer.from(bytes));
    };
    return { socket, connection, written, messages, receive };
  }

  it('delivers messages, joining fragments', () => {
    const { receive, messages } = connect();

    receive(clientFrame(1, text('{"enable"'), { fin: false }));
    receive(clientFrame(0, text(': true}')));
    receive(clientFrame(2, Uint8Array.from([7])));

    expect(messages).toStrictEqual([
      { type: 'text', data: text('{"enable": true}') },
      { type: 'binary', data: Uint8Array.from([7]) },
    ]);
  });

  it('answers a ping with a pong and ignores pongs', () => {
    const { receive, written, messages } = connect();

    receive(clientFrame(9, text('hi')));
    receive(clientFrame(10, text('late')));

    expect(written).toStrictEqual([encodeFrame('pong', text('hi'))]);
    expect(messages).toHaveLength(0);
  });

  it('sends frames until it is closed', () => {
    const { connection, written } = connect();

    connection.send('binary', Uint8Array.from([1]));
    connection.close();
    connection.send('binary', Uint8Array.from([2]));
    connection.close();

    expect(written).toStrictEqual([
      encodeFrame('binary', Uint8Array.from([1])),
      encodeFrame('close', Uint8Array.from([0x03, 0xe8])),
    ]);
    expect(connection.closed).toBe(true);
  });

  it('closes on a close frame, a protocol error, or a dropped socket', () => {
    const closing = connect();
    closing.receive(clientFrame(8, new Uint8Array(0)));
    expect(closing.connection.closed).toBe(true);

    const broken = connect();
    broken.receive(Uint8Array.from([0x83, 0]));
    expect(broken.connection.closed).toBe(true);

    const dropped = connect();
    dropped.socket.emit('close');
    expect(dropped.connection.closed).toBe(true);

    const failed = connect();
    failed.socket.emit('error', new Error('reset'));
    expect(failed.connection.closed).toBe(true);
  });
});
