import { describe, expect, it } from 'vitest';

import { ascii } from './bytes.ts';
import { PCM_RATE, rawPcmSound, wavSound } from './sound.ts';

function u32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return Array.from(bytes);
}

/** A RIFF chunk: tag, length, body, and a pad byte after an odd body. */
function chunk(
  tag: string,
  body: readonly number[],
  size = body.length,
): number[] {
  const pad = body.length % 2 === 1 ? [0] : [];
  return [...ascii(tag), ...u32(size), ...body, ...pad];
}

/** A `fmt ` chunk for 16-bit stereo at 48 kHz, with `byteRate` as given. */
function fmt(byteRate: number): number[] {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 2, true);
  view.setUint32(4, 48_000, true);
  view.setUint32(8, byteRate, true);
  view.setUint16(12, 4, true);
  view.setUint16(14, 16, true);
  return chunk('fmt ', Array.from(body));
}

function riff(...chunks: readonly number[][]): Uint8Array {
  const body = [...ascii('WAVE'), ...chunks.flat()];
  return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body]);
}

const silence = (bytes: number): number[] =>
  Array.from({ length: bytes }, () => 0);

describe('rawPcmSound', () => {
  it('wraps the bytes in a 16-bit mono 44.1 kHz WAV header', () => {
    const pcm = Uint8Array.from([1, 2, 3, 4, 5, 6]);

    const { wav } = rawPcmSound(pcm);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(String.fromCharCode(...wav.subarray(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(PCM_RATE);
    expect(view.getUint32(28, true)).toBe(PCM_RATE * 2);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(String.fromCharCode(...wav.subarray(36, 40))).toBe('data');
    expect(view.getUint32(40, true)).toBe(pcm.length);
    expect(wav.subarray(44)).toStrictEqual(pcm);
  });

  it.each([
    [88_200, 1000],
    [44_100, 500],
    [0, 0],
  ])('plays %i bytes for %i ms', (bytes, durationMs) => {
    expect(rawPcmSound(new Uint8Array(bytes)).durationMs).toBe(durationMs);
  });

  it('plays a WAV upload as raw samples, header and all, as the bar does', () => {
    const upload = riff(fmt(192_000), chunk('data', silence(88_200)));

    const { wav, durationMs } = rawPcmSound(upload);

    expect(wav).toHaveLength(44 + upload.length);
    expect(wav.subarray(44)).toStrictEqual(upload);
    expect(durationMs).toBeCloseTo((upload.length / 88_200) * 1000);
  });
});

describe('wavSound', () => {
  it('passes a WAV through, timed by its byte rate and data size', () => {
    const source = riff(fmt(192_000), chunk('data', silence(96_000)));

    const sound = wavSound(source);

    expect(sound.wav).toBe(source);
    expect(sound.durationMs).toBe(500);
  });

  it('times what rawPcmSound writes as it plays', () => {
    const { wav, durationMs } = rawPcmSound(new Uint8Array(22_050));

    expect(wavSound(wav).durationMs).toBe(durationMs);
  });

  it('skips other chunks, including the pad byte after an odd one', () => {
    const source = riff(
      fmt(1000),
      chunk('LIST', [1, 2, 3]),
      chunk('junk', [9, 9]),
      chunk('data', silence(250)),
    );

    expect(wavSound(source).durationMs).toBe(250);
  });

  it('counts only the data that is present', () => {
    const source = riff(fmt(1000), chunk('data', silence(100), 0xffff_ffff));

    expect(wavSound(source).durationMs).toBe(100);
  });

  it.each([
    ['too short to be a WAV', Uint8Array.from(ascii('RIFF'))],
    [
      'not RIFF',
      Uint8Array.from([...ascii('RIFX'), ...riff(fmt(1000)).subarray(4)]),
    ],
    [
      'not WAVE',
      Uint8Array.from([...ascii('RIFF'), ...u32(4), ...ascii('AVI ')]),
    ],
    ['missing its data chunk', riff(fmt(1000))],
    ['missing its fmt chunk', riff(chunk('data', silence(100)))],
    ['data before fmt', riff(chunk('data', silence(100)), fmt(1000))],
    ['a byte rate of 0', riff(fmt(0), chunk('data', silence(100)))],
    [
      'a fmt chunk cut before its byte rate',
      riff(chunk('fmt ', [1, 0, 2, 0, 0x80, 0xbb, 0, 0], 16)),
    ],
  ])('gives a WAV %s no playing time', (_name, source) => {
    expect(wavSound(source).durationMs).toBe(0);
  });
});
