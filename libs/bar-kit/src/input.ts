// The bar's buttons, wheel, and mode selector, from its status stream at
// /api/status/ws, read the way busylib's state_stream reads it: send
// `{"enable": true}`, then decode each binary `BSB_State.State`. busy-lib's
// own StateStream needs a browser Web Worker, so this reads the few
// protobuf fields input needs by hand (bsb-protobuf state.proto, input.proto).

import type { BarConfig } from './config.ts';
import { isAborted, sleep } from './sleep.ts';

/** A button, the wheel, or the mode selector, as the bar reports it. */
export type InputEvent =
  | {
      readonly kind: 'button';
      readonly button: 'ok' | 'back' | 'start';
      readonly action: 'press' | 'release';
    }
  | { readonly kind: 'wheel'; readonly delta: number }
  | {
      readonly kind: 'selector';
      readonly position: 'busy' | 'custom' | 'off' | 'apps' | 'settings';
    };

/** Opens the status stream: its binary messages, until it closes. */
export type StatusStream = (
  url: string,
  signal: AbortSignal,
) => AsyncIterable<Uint8Array>;

export interface ListenForInputOptions {
  /** Names the app in log messages. */
  readonly name: string;
  readonly config: BarConfig;
  /** Receives each event. An error it throws is logged, not fatal. */
  readonly handle: (event: InputEvent) => void;
  /** Stops listening. */
  readonly signal: AbortSignal;
  /** Time to wait before reopening the stream after it drops; 5 seconds. */
  readonly reconnectMs?: number;
  readonly stream?: StatusStream;
  readonly log?: Pick<Console, 'warn'>;
}

const RECONNECT_MS = 5000;

const STATUS_STREAM_PATH = '/api/status/ws';

/**
 * Feed the bar's input events to `handle` until `signal` aborts, reopening
 * the stream after `reconnectMs` when the bar reboots or leaves the network.
 * The BUSY cloud does not stream input, so on the cloud this warns once and
 * returns. Every listener gets every event, whichever app is on screen.
 */
export async function listenForInput(
  options: ListenForInputOptions,
): Promise<void> {
  const {
    name,
    config,
    handle,
    signal,
    reconnectMs = RECONNECT_MS,
    stream = openStatusStream,
    log = console,
  } = options;
  if (config.isCloud) {
    log.warn(
      `[${name}] The wheel and buttons need a direct connection to the bar; the cloud does not stream them.`,
    );
    return;
  }
  const url = statusStreamUrl(config);
  while (!isAborted(signal)) {
    try {
      for await (const message of stream(url, signal)) {
        for (const event of decodeInputEvents(message)) {
          try {
            handle(event);
          } catch (error) {
            log.warn(`[${name}] Handling an input event failed:`, error);
          }
        }
      }
      if (!isAborted(signal)) {
        log.warn(`[${name}] The bar closed its input stream.`);
      }
    } catch (error) {
      if (!isAborted(signal)) {
        log.warn(`[${name}] Lost the bar's input stream:`, error);
      }
    }
    await sleep(reconnectMs, signal);
  }
}

/**
 * The status stream's WebSocket URL for a bar on USB or Wi-Fi. A Wi-Fi
 * password goes in the `x-api-token` query parameter, as busylib sends it.
 */
export function statusStreamUrl(config: BarConfig): string {
  const base = /^[a-z][a-z\d+.-]*:\/\//iu.test(config.addr)
    ? config.addr.replace(/^http/iu, 'ws')
    : `ws://${config.addr}`;
  const url = `${base.replace(/\/+$/u, '')}${STATUS_STREAM_PATH}`;
  return config.token === undefined
    ? url
    : `${url}?x-api-token=${encodeURIComponent(config.token)}`;
}

/**
 * The status stream over Node's WebSocket: binary messages until the socket
 * closes or `signal` aborts. A failed connection closes the socket too.
 */
export async function* openStatusStream(
  url: string,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  // Written by the socket's callbacks, read by the loop below.
  const received: { readonly messages: Uint8Array[]; closed: boolean } = {
    messages: [],
    closed: false,
  };
  let wake: (() => void) | undefined;
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  const close = (): void => {
    socket.close();
  };
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ enable: true }));
  });
  socket.addEventListener('message', (event) => {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) {
      received.messages.push(new Uint8Array(data));
      notify();
    }
  });
  socket.addEventListener('close', () => {
    received.closed = true;
    notify();
  });
  signal.addEventListener('abort', close, { once: true });
  try {
    for (;;) {
      const message = received.messages.shift();
      if (message !== undefined) {
        yield message;
      } else if (received.closed) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
  } finally {
    signal.removeEventListener('abort', close);
    socket.close();
  }
}

const BUTTONS = ['ok', 'back', 'start'] as const;
const ACTIONS = ['press', 'release'] as const;
const POSITIONS = ['busy', 'custom', 'off', 'apps', 'settings'] as const;

// Wire types.
const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;
const FIXED32 = 5;

/**
 * The input events one `State` message carries, in order. Anything else
 * the stream sends, such as screen frames, gives none. proto3 leaves out
 * an enum that holds its first value, so a missing button is OK and a
 * missing action PRESS, as busylib reads them. Throws on a message that is
 * not protobuf.
 */
export function decodeInputEvents(message: Uint8Array): InputEvent[] {
  const events: InputEvent[] = [];
  // State.updates (2) holds StateUpdates; StateUpdate.input (11) an event.
  for (const update of fieldsOf(message, 2)) {
    for (const input of fieldsOf(update, 11)) {
      const event = inputEvent(input);
      if (event !== undefined) {
        events.push(event);
      }
    }
  }
  return events;
}

function inputEvent(input: Uint8Array): InputEvent | undefined {
  const reader = new ProtoReader(input);
  let event: InputEvent | undefined;
  while (!reader.done) {
    const { field, wireType } = reader.tag();
    if (wireType !== LENGTH_DELIMITED) {
      reader.skip(wireType);
      continue;
    }
    const body = new ProtoReader(reader.bytes());
    // A oneof: the last of button (1), switch (2), and encoder (3) wins.
    if (field === 1) {
      const values = body.varints();
      const button = BUTTONS[values.get(1) ?? 0];
      const action = ACTIONS[values.get(2) ?? 0];
      event =
        button === undefined || action === undefined
          ? undefined
          : { kind: 'button', button, action };
    } else if (field === 2) {
      const position = POSITIONS[body.varints().get(1) ?? 0];
      event =
        position === undefined ? undefined : { kind: 'selector', position };
    } else if (field === 3) {
      // sint32, zigzag-encoded.
      const raw = body.varints().get(1) ?? 0;
      event = {
        kind: 'wheel',
        delta: raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2,
      };
    }
  }
  return event;
}

/** Every length-delimited `field` of `message`, in order. */
function fieldsOf(message: Uint8Array, wanted: number): Uint8Array[] {
  const reader = new ProtoReader(message);
  const found: Uint8Array[] = [];
  while (!reader.done) {
    const { field, wireType } = reader.tag();
    if (field === wanted && wireType === LENGTH_DELIMITED) {
      found.push(reader.bytes());
    } else {
      reader.skip(wireType);
    }
  }
  return found;
}

/** Reads one protobuf message, field by field. */
class ProtoReader {
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get done(): boolean {
    return this.#offset >= this.#bytes.length;
  }

  tag(): { readonly field: number; readonly wireType: number } {
    const tag = this.varint();
    return { field: Math.floor(tag / 8), wireType: tag % 8 };
  }

  /** An unsigned varint, exact up to 2^53. */
  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.#bytes[this.#offset];
      if (byte === undefined) {
        throw new RangeError('A protobuf varint runs past the message.');
      }
      this.#offset += 1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        return value;
      }
      scale *= 0x80;
    }
  }

  bytes(): Uint8Array {
    const length = this.varint();
    const end = this.#offset + length;
    if (end > this.#bytes.length) {
      throw new RangeError('A protobuf field runs past the message.');
    }
    const bytes = this.#bytes.subarray(this.#offset, end);
    this.#offset = end;
    return bytes;
  }

  /** The message's varint fields by number; the last of a number wins. */
  varints(): Map<number, number> {
    const values = new Map<number, number>();
    while (!this.done) {
      const { field, wireType } = this.tag();
      if (wireType === VARINT) {
        values.set(field, this.varint());
      } else {
        this.skip(wireType);
      }
    }
    return values;
  }

  skip(wireType: number): void {
    if (wireType === VARINT) {
      this.varint();
    } else if (wireType === LENGTH_DELIMITED) {
      this.bytes();
    } else if (wireType === FIXED64 || wireType === FIXED32) {
      const end = this.#offset + (wireType === FIXED64 ? 8 : 4);
      if (end > this.#bytes.length) {
        throw new RangeError('A protobuf field runs past the message.');
      }
      this.#offset = end;
    } else {
      throw new RangeError(`Unknown protobuf wire type ${wireType}.`);
    }
  }
}
