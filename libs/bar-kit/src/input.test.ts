import { describe, expect, it, vi } from 'vitest';

import type { BarConfig } from './config.ts';
import type { InputEvent, StatusStream } from './input.ts';
import {
  decodeInputEvents,
  listenForInput,
  openStatusStream,
  statusStreamUrl,
} from './input.ts';

/** Writes protobuf the way the bar does, for messages to decode. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function field(number: number, value: number): number[] {
  return [...varint(number * 8), ...varint(value)];
}

function nested(number: number, body: readonly number[]): number[] {
  return [...varint(number * 8 + 2), ...varint(body.length), ...body];
}

/** A `State` with a timestamp and one `StateUpdate.input` per event. */
function state(...inputs: (readonly number[])[]): Uint8Array {
  const timestamp = [...varint(1 * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8];
  return Uint8Array.from([
    ...timestamp,
    ...inputs.flatMap((input) => nested(2, nested(11, input))),
  ]);
}

const button = (button: number, action: number) =>
  nested(1, [...field(1, button), ...field(2, action)]);
const selector = (position: number) => nested(2, field(1, position));
const wheel = (zigzag: number) => nested(3, field(1, zigzag));

const USB: BarConfig = { addr: '10.0.4.20', token: undefined, isCloud: false };

describe('decodeInputEvents', () => {
  it('reads buttons, the wheel, and the selector in order', () => {
    expect(
      decodeInputEvents(
        state(button(2, 1), wheel(1), wheel(2), selector(3), wheel(5)),
      ),
    ).toStrictEqual([
      { kind: 'button', button: 'start', action: 'release' },
      { kind: 'wheel', delta: -1 },
      { kind: 'wheel', delta: 1 },
      { kind: 'selector', position: 'apps' },
      { kind: 'wheel', delta: -3 },
    ]);
  });

  it('reads the values proto3 leaves out as the first ones', () => {
    expect(
      decodeInputEvents(state(nested(1, []), nested(2, []), nested(3, []))),
    ).toStrictEqual([
      { kind: 'button', button: 'ok', action: 'press' },
      { kind: 'selector', position: 'busy' },
      { kind: 'wheel', delta: 0 },
    ]);
  });

  it('gives nothing for frames, heartbeats, and other updates', () => {
    const frame = Uint8Array.from(nested(2, nested(10, [1, 2, 3])));

    expect(decodeInputEvents(frame)).toStrictEqual([]);
    expect(decodeInputEvents(state())).toStrictEqual([]);
  });

  it('skips fields and values it does not know', () => {
    const unknown = [
      ...field(9, 300),
      ...varint(8 * 8 + 5),
      1,
      2,
      3,
      4,
      ...nested(7, [1]),
    ];

    expect(
      decodeInputEvents(
        state([...unknown, ...button(1, 0)], button(7, 0), selector(9), [
          ...field(4, 1),
        ]),
      ),
    ).toStrictEqual([{ kind: 'button', button: 'back', action: 'press' }]);
  });

  it('keeps the last event of a oneof', () => {
    expect(
      decodeInputEvents(state([...button(0, 0), ...wheel(4)])),
    ).toStrictEqual([{ kind: 'wheel', delta: 2 }]);
  });

  it('refuses a message that is not protobuf', () => {
    expect(() => decodeInputEvents(Uint8Array.from([0x80]))).toThrow(
      RangeError,
    );
    expect(() => decodeInputEvents(Uint8Array.from([0x12, 5, 1]))).toThrow(
      RangeError,
    );
    expect(() => decodeInputEvents(Uint8Array.from([0x09, 1]))).toThrow(
      RangeError,
    );
    expect(() => decodeInputEvents(Uint8Array.from([0x0b]))).toThrow(
      'Unknown protobuf wire type 3.',
    );
  });
});

describe('statusStreamUrl', () => {
  it.each([
    ['10.0.4.20', 'ws://10.0.4.20/api/status/ws'],
    ['127.0.0.1:8080', 'ws://127.0.0.1:8080/api/status/ws'],
    ['http://bar.local/', 'ws://bar.local/api/status/ws'],
    ['https://bar.example', 'wss://bar.example/api/status/ws'],
  ])('reaches %s at %s', (addr, url) => {
    expect(statusStreamUrl({ ...USB, addr })).toBe(url);
  });

  it('sends the Wi-Fi password as busylib does', () => {
    expect(statusStreamUrl({ ...USB, token: 'p@ss word' })).toBe(
      'ws://10.0.4.20/api/status/ws?x-api-token=p%40ss%20word',
    );
  });
});

/** Each call opens the next stream: messages, or an error to throw. */
function streams(...behaviours: (Uint8Array[] | Error)[]) {
  const urls: string[] = [];
  const pending = [...behaviours];
  const stream: StatusStream = async function* (url) {
    urls.push(url);
    const behaviour = pending.shift();
    if (behaviour === undefined) {
      throw new Error('no more streams');
    }
    if (behaviour instanceof Error) {
      throw behaviour;
    }
    for (const message of behaviour) {
      // Each message arrives on its own, as from a socket.
      await Promise.resolve();
      yield message;
    }
  };
  return { stream, urls };
}

describe('listenForInput', () => {
  it('passes each event on and reopens the stream after it drops', async () => {
    const controller = new AbortController();
    const handled: InputEvent[] = [];
    const log = { warn: vi.fn<Console['warn']>() };
    const { stream, urls } = streams(
      [state(wheel(2)), state(), state(button(0, 0))],
      new Error('bar rebooted'),
      [state(wheel(1))],
    );

    await listenForInput({
      name: 'test',
      config: USB,
      handle: (event) => {
        handled.push(event);
        if (handled.length === 3) {
          controller.abort();
        }
      },
      signal: controller.signal,
      reconnectMs: 0,
      stream,
      log,
    });

    expect(handled).toStrictEqual([
      { kind: 'wheel', delta: 1 },
      { kind: 'button', button: 'ok', action: 'press' },
      { kind: 'wheel', delta: -1 },
    ]);
    expect(urls).toStrictEqual([
      'ws://10.0.4.20/api/status/ws',
      'ws://10.0.4.20/api/status/ws',
      'ws://10.0.4.20/api/status/ws',
    ]);
    expect(log.warn.mock.calls).toStrictEqual([
      ['[test] The bar closed its input stream.'],
      ["[test] Lost the bar's input stream:", new Error('bar rebooted')],
    ]);
  });

  it('logs a handler that throws and goes on listening', async () => {
    const controller = new AbortController();
    const log = { warn: vi.fn<Console['warn']>() };
    const handled: InputEvent[] = [];
    const { stream } = streams([state(wheel(2), wheel(4))]);

    await listenForInput({
      name: 'test',
      config: USB,
      handle: (event) => {
        handled.push(event);
        if (handled.length === 1) {
          throw new Error('bug');
        }
        controller.abort();
      },
      signal: controller.signal,
      stream,
      log,
    });

    expect(handled).toHaveLength(2);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[test] Handling an input event failed:',
      new Error('bug'),
    );
  });

  it('stops quietly when the signal aborts during a stream', async () => {
    const controller = new AbortController();
    const log = { warn: vi.fn<Console['warn']>() };
    const stream: StatusStream = async function* () {
      await Promise.resolve();
      controller.abort();
      yield state();
      throw new Error('closed by the abort');
    };

    await listenForInput({
      name: 'test',
      config: USB,
      handle: () => undefined,
      signal: controller.signal,
      stream,
      log,
    });

    expect(log.warn).not.toHaveBeenCalled();
  });

  it('warns once and stops on the cloud, which does not stream input', async () => {
    const log = { warn: vi.fn<Console['warn']>() };
    const { stream, urls } = streams();

    await listenForInput({
      name: 'test',
      config: { addr: 'https://api.busy.app', token: 'secret', isCloud: true },
      handle: () => undefined,
      signal: new AbortController().signal,
      stream,
      log,
    });

    expect(urls).toStrictEqual([]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[test] The wheel and buttons need a direct connection to the bar; the cloud does not stream them.',
    );
  });
});

/** A WebSocket the test drives by hand, installed as the global. */
class FakeSocket extends EventTarget {
  static opened: FakeSocket[] = [];
  readonly url: string;
  binaryType = 'blob';
  readonly sent: string[] = [];
  closes = 0;

  constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.opened.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closes += 1;
    this.dispatchEvent(new Event('close'));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function stubWebSocket(): void {
  FakeSocket.opened = [];
  vi.stubGlobal('WebSocket', FakeSocket);
}

describe('openStatusStream', () => {
  it('enables the stream and yields its binary messages until it closes', async () => {
    stubWebSocket();
    const messages = openStatusStream(
      'ws://bar/api/status/ws',
      new AbortController().signal,
    );
    const first = messages.next();
    const [socket] = FakeSocket.opened;
    if (socket === undefined) {
      throw new Error('No socket opened.');
    }

    socket.dispatchEvent(new Event('open'));
    socket.receive('a text message');
    socket.receive(Uint8Array.from([1, 2]).buffer);
    socket.receive(Uint8Array.from([3]).buffer);

    expect(socket.binaryType).toBe('arraybuffer');
    expect(socket.sent).toStrictEqual(['{"enable":true}']);
    expect((await first).value).toStrictEqual(Uint8Array.from([1, 2]));
    expect((await messages.next()).value).toStrictEqual(Uint8Array.from([3]));

    const end = messages.next();
    socket.dispatchEvent(new Event('close'));

    expect(await end).toStrictEqual({ done: true, value: undefined });
  });

  it('closes the socket when the signal aborts', async () => {
    stubWebSocket();
    const controller = new AbortController();
    const messages = openStatusStream(
      'ws://bar/api/status/ws',
      controller.signal,
    );
    const next = messages.next();
    const [socket] = FakeSocket.opened;

    controller.abort();

    expect(await next).toStrictEqual({ done: true, value: undefined });
    expect(socket?.closes).toBeGreaterThan(0);
  });
});
