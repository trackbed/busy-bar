import { describe, expect, it } from 'vitest';

import type { InputEvent } from './protobuf.ts';
import { encodeInputState, ProtoWriter } from './protobuf.ts';

const TIMESTAMP = 1_760_961_600_000;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('encodeInputState', () => {
  // Each vector was decoded with busylib 2.6.0 (`_decode_state` and
  // `features.input_events`) to the event it is named after.
  it.each<[InputEvent, string]>([
    [
      { kind: 'button', button: 'ok', action: 'press' },
      '09009a7d019a01000012085a060a0408001000',
    ],
    [
      { kind: 'button', button: 'start', action: 'release' },
      '09009a7d019a01000012085a060a0408021001',
    ],
    [
      { kind: 'selector', position: 'busy' },
      '09009a7d019a01000012065a0412020800',
    ],
    [
      { kind: 'selector', position: 'apps' },
      '09009a7d019a01000012065a0412020803',
    ],
    [{ kind: 'wheel', delta: -3 }, '09009a7d019a01000012065a041a020805'],
    [{ kind: 'wheel', delta: 2 }, '09009a7d019a01000012065a041a020804'],
  ])('encodes %j as busylib expects', (event, expected) => {
    expect(hex(encodeInputState(event, TIMESTAMP))).toBe(expected);
  });

  it('clamps a negative timestamp to zero', () => {
    expect(
      hex(encodeInputState({ kind: 'wheel', delta: 1 }, -5)).slice(0, 18),
    ).toBe('090000000000000000');
  });
});

describe('ProtoWriter', () => {
  it('writes multi-byte varints', () => {
    expect(hex(new ProtoWriter().varint(1, 300).finish())).toBe('08ac02');
  });
});
