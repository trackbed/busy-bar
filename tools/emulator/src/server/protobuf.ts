// Encoding the status stream's protobuf messages by hand: the emulator only
// writes a handful of message types, so a full protobuf runtime is not
// worth a dependency. Field numbers follow bsb-protobuf (state.proto,
// input.proto), the schema busylib decodes with.

import type { InputEvent } from '../device/device.ts';

const BUTTONS = { ok: 0, back: 1, start: 2 } as const;
const ACTIONS = { press: 0, release: 1 } as const;
const POSITIONS = { busy: 0, custom: 1, off: 2, apps: 3, settings: 4 } as const;

// Wire types.
const VARINT = 0;
const FIXED64 = 1;
const LENGTH_DELIMITED = 2;

/** Appends fields to one protobuf message. */
export class ProtoWriter {
  readonly #bytes: number[] = [];

  /** An unsigned integer or enum field. */
  varint(field: number, value: number): this {
    this.#tag(field, VARINT);
    this.#varint(value);
    return this;
  }

  /** A `sint32` field, zigzag-encoded. */
  sint32(field: number, value: number): this {
    return this.varint(field, ((value << 1) ^ (value >> 31)) >>> 0);
  }

  /** A `fixed64` field, little-endian. */
  fixed64(field: number, value: bigint): this {
    this.#tag(field, FIXED64);
    for (let i = 0n; i < 8n; i += 1n) {
      this.#bytes.push(Number((value >> (i * 8n)) & 0xffn));
    }
    return this;
  }

  /** A nested message or byte string. */
  bytes(field: number, data: Uint8Array): this {
    this.#tag(field, LENGTH_DELIMITED);
    this.#varint(data.length);
    this.#bytes.push(...data);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }

  #tag(field: number, wireType: number): void {
    this.#varint((field << 3) | wireType);
  }

  #varint(value: number): void {
    let rest = value >>> 0;
    while (rest >= 0x80) {
      this.#bytes.push((rest & 0x7f) | 0x80);
      rest >>>= 7;
    }
    this.#bytes.push(rest);
  }
}

/** The `InputEvent` message for one button, wheel, or selector event. */
function encodeInputEvent(event: InputEvent): Uint8Array {
  const writer = new ProtoWriter();
  switch (event.kind) {
    case 'button':
      return writer
        .bytes(
          1,
          new ProtoWriter()
            .varint(1, BUTTONS[event.button])
            .varint(2, ACTIONS[event.action])
            .finish(),
        )
        .finish();
    case 'selector':
      return writer
        .bytes(
          2,
          new ProtoWriter().varint(1, POSITIONS[event.position]).finish(),
        )
        .finish();
    case 'wheel':
      return writer
        .bytes(3, new ProtoWriter().sint32(1, event.delta).finish())
        .finish();
  }
}

/**
 * A `State` message carrying one input event (StateUpdate field 11).
 * `timestamp` is milliseconds since the epoch.
 */
export function encodeInputState(
  event: InputEvent,
  timestamp: number,
): Uint8Array {
  const update = new ProtoWriter().bytes(11, encodeInputEvent(event)).finish();
  return new ProtoWriter()
    .fixed64(1, stamp(timestamp))
    .bytes(2, update)
    .finish();
}

/** What the bar reports about itself when a stream starts. */
export interface DeviceSnapshot {
  readonly name: string;
  readonly brightness: 'auto' | number;
  readonly volume: number;
}

/** A heartbeat: a `State` with only its timestamp. */
export function encodeHeartbeat(timestamp: number): Uint8Array {
  return new ProtoWriter().fixed64(1, stamp(timestamp)).finish();
}

/**
 * A `State` carrying the front display: a `Frame` (StateUpdate field 10) of
 * 72x16 RGB888 pixels in B,G,R order, run-length encoded in 3-byte blocks,
 * as the firmware streams it.
 */
export function encodeFrameState(
  rle: Uint8Array,
  timestamp: number,
): Uint8Array {
  return new ProtoWriter()
    .fixed64(1, stamp(timestamp))
    .bytes(2, new ProtoWriter().bytes(10, encodeFrame(rle)).finish())
    .finish();
}

/**
 * The snapshot sent when a client enables the stream: device name,
 * brightness, volume, power, and the current frame.
 */
export function encodeSnapshot(
  device: DeviceSnapshot,
  rle: Uint8Array,
  timestamp: number,
): Uint8Array {
  const brightness =
    device.brightness === 'auto'
      ? new ProtoWriter().bytes(1, new Uint8Array(0)).varint(3, 80)
      : new ProtoWriter()
          .bytes(2, new ProtoWriter().varint(1, device.brightness).finish())
          .varint(3, device.brightness);
  // Power is reported as "known": charged, 100 %, on USB.
  const power = new ProtoWriter()
    .bytes(
      2,
      new ProtoWriter()
        .varint(1, 2)
        .varint(2, 100)
        .varint(3, 4200)
        .varint(5, 5000)
        .finish(),
    )
    .finish();
  const updates = [
    new ProtoWriter().bytes(3, brightness.finish()).finish(),
    new ProtoWriter().bytes(2, power).finish(),
    new ProtoWriter()
      .bytes(4, new ProtoWriter().varint(1, device.volume).finish())
      .finish(),
    new ProtoWriter()
      .bytes(
        1,
        new ProtoWriter()
          .bytes(1, new TextEncoder().encode(device.name))
          .finish(),
      )
      .finish(),
    new ProtoWriter().bytes(10, encodeFrame(rle)).finish(),
  ];
  const writer = new ProtoWriter().fixed64(1, stamp(timestamp));
  for (const update of updates) {
    writer.bytes(2, update);
  }
  return writer.finish();
}

/** The error a client gets when the stream already has four clients. */
export function encodeTooManyClients(timestamp: number): Uint8Array {
  return new ProtoWriter()
    .fixed64(1, stamp(timestamp))
    .bytes(3, new ProtoWriter().varint(1, 0).varint(2, 0).finish())
    .finish();
}

function encodeFrame(rle: Uint8Array): Uint8Array {
  return new ProtoWriter()
    .varint(1, 0) // FRONT
    .varint(2, 72)
    .varint(3, 16)
    .varint(4, 1) // RUN_LENGTH
    .varint(5, 0) // RGB888
    .bytes(6, rle)
    .finish();
}

function stamp(timestamp: number): bigint {
  return BigInt(Math.max(0, Math.round(timestamp)));
}
