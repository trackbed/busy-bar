import { describe, expect, it } from 'vitest';

import { animFile } from '../__tests__/anim-fixture.ts';
import type { AnimFrameSpec, AnimSpec } from '../__tests__/anim-fixture.ts';
import { readAnimFile } from './anim-file.ts';
import { AnimationError } from './animation.ts';
import type { Bitmap } from './png.ts';

const BGR888 = 0;
const GRAY4 = 1;
const BGRA8888 = 2;

const MASK_NONE = 0;
const MASK_ALL = 1;
const MASK_RUNS_ABSENT_FIRST = 2;
const MASK_RUNS_PRESENT_FIRST = 3;
const MASK_BITMAP = 4;

const RAW = 0;
const RLE = 1;
const QOI = 2;

const ABSENT = [0, 0, 0, 0];

/** A frame's pixels as [r, g, b, a] lists. */
function pixels(frame: Bitmap | undefined): number[][] {
  const rgba = frame?.rgba ?? new Uint8Array(0);
  const out: number[][] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    out.push(Array.from(rgba.subarray(i, i + 4)));
  }
  return out;
}

/** The pixels of a one-frame animation. */
function decodeFrame(
  width: number,
  height: number,
  color: number,
  frame: AnimFrameSpec,
): number[][] {
  return pixels(
    readAnimFile(animFile({ width, height, color, frames: [frame] })).frames[0],
  );
}

describe('readAnimFile', () => {
  it('reads the size, frame rate, and sections', () => {
    const animation = readAnimFile(
      animFile({
        width: 2,
        height: 1,
        color: BGR888,
        fps: 12,
        frames: [
          { mask: MASK_ALL, pixels: RAW, data: [0, 0, 255, 0, 255, 0] },
          { mask: MASK_NONE, pixels: RAW },
          { mask: MASK_NONE, pixels: RAW },
        ],
        sections: [
          { name: 'idle', start: 1, end: 2 },
          { name: 'blink', start: 2, end: 2 },
        ],
      }),
    );

    expect(animation.width).toBe(2);
    expect(animation.height).toBe(1);
    expect(animation.fps).toBe(12);
    expect(animation.frames).toHaveLength(3);
    expect([...animation.sections]).toStrictEqual([
      ['default', { start: 0, end: 2 }],
      ['idle', { start: 1, end: 2 }],
      ['blink', { start: 2, end: 2 }],
    ]);
  });

  it('decodes raw BGR888 pixels as opaque colours', () => {
    expect(
      decodeFrame(2, 1, BGR888, {
        mask: MASK_ALL,
        pixels: RAW,
        data: [30, 20, 10, 0, 0, 255],
      }),
    ).toStrictEqual([
      [10, 20, 30, 255],
      [255, 0, 0, 255],
    ]);
  });

  it('keeps the alpha of raw BGRA8888 pixels', () => {
    expect(
      decodeFrame(2, 1, BGRA8888, {
        mask: MASK_ALL,
        pixels: RAW,
        data: [30, 20, 10, 128, 0, 0, 255, 0],
      }),
    ).toStrictEqual([
      [10, 20, 30, 128],
      [255, 0, 0, 0],
    ]);
  });

  it('unpacks Gray4 pixels high nibble first into opaque grey', () => {
    expect(
      decodeFrame(3, 1, GRAY4, {
        mask: MASK_ALL,
        pixels: RAW,
        data: [0xa5, 0xf0],
      }),
    ).toStrictEqual([
      [0xa0, 0xa0, 0xa0, 255],
      [0x50, 0x50, 0x50, 255],
      [0xf0, 0xf0, 0xf0, 255],
    ]);
  });

  it.each([
    [
      'BGR888 in 3-byte blocks',
      BGR888,
      [0x02, 30, 20, 10, 0x81, 0, 0, 255],
      [
        [10, 20, 30, 255],
        [10, 20, 30, 255],
        [255, 0, 0, 255],
      ],
    ],
    [
      'Gray4 in 1-byte blocks',
      GRAY4,
      [0x02, 0x7f],
      [
        [0x70, 0x70, 0x70, 255],
        [0xf0, 0xf0, 0xf0, 255],
        [0x70, 0x70, 0x70, 255],
        [0xf0, 0xf0, 0xf0, 255],
      ],
    ],
    [
      'BGRA8888 in 4-byte blocks',
      BGRA8888,
      [0x81, 30, 20, 10, 128, 0x02, 1, 2, 3, 4],
      [
        [10, 20, 30, 128],
        [3, 2, 1, 4],
        [3, 2, 1, 4],
      ],
    ],
  ])('expands toolbox RLE pixels: %s', (_name, color, data, expected) => {
    expect(
      decodeFrame(expected.length, 1, color, {
        mask: MASK_ALL,
        pixels: RLE,
        data,
      }),
    ).toStrictEqual(expected);
  });

  it('decodes every QOI op, starting from opaque black and an empty table', () => {
    // Each op stores its pixel in the table at (3r + 5g + 7b + 11a) % 64.
    const data = [
      // RGB, keeping the alpha it starts with: (10, 20, 30, 255) in slot 9.
      [0xfe, 10, 20, 30],
      // RGBA: (1, 2, 3, 128) in slot 34.
      [0xff, 1, 2, 3, 128],
      // DIFF -2, -1, +1, wrapping red: (255, 1, 4, 128) in slot 30.
      [0b01_00_01_11],
      // RGB keeps the previous alpha: (7, 8, 9, 128).
      [0xfe, 7, 8, 9],
      // INDEX 9.
      [0x09],
      // LUMA: green +5, red 5 + 3, blue 5 - 2: (18, 25, 33, 255) in slot 15.
      [0b10_100101, 0b1011_0110],
      // RUN of two.
      [0b11_000001],
      // INDEX 34, 30, and 15 return what RGBA, DIFF, and LUMA stored.
      [0x22, 0x1e, 0x0f],
      // INDEX 0 was never written: transparent black.
      [0x00],
    ].flat();

    expect(
      decodeFrame(12, 1, BGRA8888, { mask: MASK_ALL, pixels: QOI, data }),
    ).toStrictEqual([
      [10, 20, 30, 255],
      [1, 2, 3, 128],
      [255, 1, 4, 128],
      [7, 8, 9, 128],
      [10, 20, 30, 255],
      [18, 25, 33, 255],
      [18, 25, 33, 255],
      [18, 25, 33, 255],
      [1, 2, 3, 128],
      [255, 1, 4, 128],
      [18, 25, 33, 255],
      ABSENT,
    ]);
  });

  it('starts every frame with a fresh QOI table and previous pixel', () => {
    const animation = readAnimFile(
      animFile({
        width: 2,
        height: 1,
        color: BGR888,
        frames: [
          {
            mask: MASK_ALL,
            pixels: QOI,
            data: [0xfe, 10, 20, 30, 0xfe, 40, 50, 60],
          },
          // DIFF +1, +1, +1 from opaque black, then INDEX 9, empty again.
          { mask: MASK_ALL, pixels: QOI, data: [0b01_11_11_11, 0x09] },
        ],
      }),
    );

    expect(animation.frames.map(pixels)).toStrictEqual([
      [
        [10, 20, 30, 255],
        [40, 50, 60, 255],
      ],
      [[1, 1, 1, 255], ABSENT],
    ]);
  });

  it('keeps the pixels a mask leaves out from the frame before', () => {
    const red = [0, 0, 255];
    const green = [0, 255, 0];
    const blue = [255, 0, 0];
    const animation = readAnimFile(
      animFile({
        width: 3,
        height: 1,
        color: BGR888,
        frames: [
          { mask: MASK_ALL, pixels: RAW, data: [...red, ...green, ...blue] },
          { mask: MASK_NONE, pixels: RAW },
          {
            mask: MASK_BITMAP,
            pixels: RAW,
            maskBits: '010',
            data: [255, 255, 255],
          },
        ],
      }),
    );

    expect(animation.frames.map(pixels)).toStrictEqual([
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
      ],
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
      ],
      [
        [255, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 255, 255],
      ],
    ]);
  });

  it('starts from transparent black before the first frame', () => {
    expect(
      decodeFrame(3, 1, BGR888, {
        mask: MASK_BITMAP,
        pixels: RAW,
        maskBits: '100',
        data: [0, 0, 255],
      }),
    ).toStrictEqual([[255, 0, 0, 255], ABSENT, ABSENT]);
  });

  it.each([
    [
      'absent first',
      MASK_RUNS_ABSENT_FIRST,
      // 1 absent, 2 present, 3 absent.
      '001 010 011',
      [1, 1, 1, 2, 2, 2],
      [ABSENT, [1, 1, 1, 255], [2, 2, 2, 255], ABSENT, ABSENT, ABSENT],
    ],
    [
      'present first',
      MASK_RUNS_PRESENT_FIRST,
      // 2 present, 3 absent, 1 present.
      '010 011 001',
      [1, 1, 1, 2, 2, 2, 3, 3, 3],
      [[1, 1, 1, 255], [2, 2, 2, 255], ABSENT, ABSENT, ABSENT, [3, 3, 3, 255]],
    ],
  ])(
    'fills run-length masks in raster order, %s',
    (_name, mask, maskBits, data, expected) => {
      expect(
        decodeFrame(3, 2, BGR888, { mask, pixels: RAW, maskBits, data }),
      ).toStrictEqual(expected);
    },
  );

  it('reads runs of 7 or more from the next eight bits, and empty runs', () => {
    // 0 absent, 9 present (long form), 1 absent, 2 present.
    expect(
      decodeFrame(12, 1, GRAY4, {
        mask: MASK_RUNS_ABSENT_FIRST,
        pixels: RAW,
        maskBits: '000 111 00001001 001 010',
        data: [0x12, 0x34, 0x56, 0x78, 0x9a, 0xb0],
      }).map(([grey = 0]) => grey),
    ).toStrictEqual([
      0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0, 0xa0, 0xb0,
    ]);
    // A run of exactly 7 needs the long form: the 3-bit 7 is the marker.
    expect(
      decodeFrame(8, 1, GRAY4, {
        mask: MASK_RUNS_PRESENT_FIRST,
        pixels: RAW,
        maskBits: '111 00000111 001',
        data: [0x11, 0x11, 0x11, 0x10],
      }).map(([grey = 0]) => grey),
    ).toStrictEqual([0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0]);
  });

  it('stops a run-length mask after its bit count, ignoring padding', () => {
    expect(
      decodeFrame(4, 1, BGR888, {
        mask: MASK_RUNS_ABSENT_FIRST,
        pixels: RAW,
        // 1 absent, 2 present, then two padding bits that are not a run.
        maskBits: '001 010 11',
        maskLength: 6,
        data: [1, 1, 1, 2, 2, 2],
      }),
    ).toStrictEqual([ABSENT, [1, 1, 1, 255], [2, 2, 2, 255], ABSENT]);
  });

  it('drops the part of a run past the last pixel', () => {
    expect(
      decodeFrame(2, 1, BGR888, {
        mask: MASK_RUNS_PRESENT_FIRST,
        pixels: RAW,
        maskBits: '110',
        data: [1, 1, 1, 2, 2, 2],
      }),
    ).toStrictEqual([
      [1, 1, 1, 255],
      [2, 2, 2, 255],
    ]);
  });

  it('reads bitmap masks one bit per pixel, most significant first', () => {
    expect(
      decodeFrame(3, 2, BGR888, {
        mask: MASK_BITMAP,
        pixels: RAW,
        maskBits: '101 001',
        data: [1, 1, 1, 2, 2, 2, 3, 3, 3],
      }),
    ).toStrictEqual([
      [1, 1, 1, 255],
      ABSENT,
      [2, 2, 2, 255],
      ABSENT,
      ABSENT,
      [3, 3, 3, 255],
    ]);
  });

  it('leaves pixels past the end of a bitmap mask absent', () => {
    expect(
      decodeFrame(10, 1, BGR888, {
        mask: MASK_BITMAP,
        pixels: RAW,
        maskBits: '01000001',
        data: [1, 1, 1, 2, 2, 2],
      }),
    ).toStrictEqual([
      ABSENT,
      [1, 1, 1, 255],
      ABSENT,
      ABSENT,
      ABSENT,
      ABSENT,
      ABSENT,
      [2, 2, 2, 255],
      ABSENT,
      ABSENT,
    ]);
  });

  it('reads a file that sits inside a larger buffer', () => {
    const bytes = animFile({
      width: 1,
      height: 1,
      color: BGR888,
      frames: [{ mask: MASK_ALL, pixels: RAW, data: [3, 2, 1] }],
    });
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 5);

    expect(readAnimFile(padded.subarray(5, 5 + bytes.length))).toStrictEqual(
      readAnimFile(bytes),
    );
  });

  const ONE_PIXEL: AnimSpec = {
    width: 1,
    height: 1,
    color: BGR888,
    frames: [{ mask: MASK_ALL, pixels: RAW, data: [0, 0, 0] }],
  };
  // Twelve bytes of pixels: enough frame data to read as a section record.
  const FOUR_PIXELS: AnimSpec = {
    width: 2,
    height: 2,
    color: BGR888,
    frames: [
      {
        mask: MASK_ALL,
        pixels: RAW,
        data: Array.from({ length: 12 }, () => 0),
      },
    ],
  };
  const TWO_FRAMES: AnimSpec = {
    ...ONE_PIXEL,
    frames: [...ONE_PIXEL.frames, { mask: MASK_NONE, pixels: RAW }],
  };
  const withFrame = (frame: AnimFrameSpec, color = BGR888): Uint8Array =>
    animFile({ width: 2, height: 1, color, frames: [frame] });

  it("accepts a grey frame's padding nibble, as the firmware does", () => {
    expect(
      decodeFrame(3, 1, GRAY4, {
        mask: MASK_ALL,
        pixels: RAW,
        data: [0x12, 0x30],
      }),
    ).toStrictEqual([
      [0x10, 0x10, 0x10, 255],
      [0x20, 0x20, 0x20, 255],
      [0x30, 0x30, 0x30, 255],
    ]);
  });

  it.each([
    [
      'a wrong signature',
      animFile({ ...ONE_PIXEL, signature: 'bicycle2' }),
      'Not a bicycle1 animation file.',
    ],
    [
      'a file shorter than the header',
      animFile(ONE_PIXEL).subarray(0, 33),
      'Not a bicycle1 animation file.',
    ],
    [
      'flags',
      animFile({ ...ONE_PIXEL, flags: 1 }),
      'The animation header is invalid.',
    ],
    [
      'an unknown colour format',
      animFile({ ...ONE_PIXEL, color: 3 }),
      'The animation header is invalid.',
    ],
    [
      'no sections',
      animFile({ ...ONE_PIXEL, sectionCount: 0 }),
      'The animation header is invalid.',
    ],
    [
      'no frames',
      animFile({ ...ONE_PIXEL, frameCount: 0 }),
      'The animation header is invalid.',
    ],
    [
      'a trailing byte',
      Uint8Array.from([...animFile(ONE_PIXEL), 0]),
      'The animation header is invalid.',
    ],
    [
      'a missing byte',
      animFile(ONE_PIXEL).subarray(0, -1),
      'The animation header is invalid.',
    ],
    [
      'more section records than the sections chunk holds',
      animFile({ ...FOUR_PIXELS, sectionCount: 2 }),
      'The section table is cut short.',
    ],
    [
      'a section name not ended inside the sections chunk',
      animFile({
        ...FOUR_PIXELS,
        sections: [{ name: 'idle', start: 0, end: 0 }],
        trimSections: 1,
      }),
      'The section table is cut short.',
    ],
    [
      'a first section with another name',
      animFile({
        ...ONE_PIXEL,
        sectionRecords: [{ name: 'idle', start: 0, end: 0 }],
      }),
      'The first section must be "default", covering every frame.',
    ],
    [
      'a default section starting late',
      animFile({
        ...TWO_FRAMES,
        sectionRecords: [{ name: 'default', start: 1, end: 1 }],
      }),
      'The first section must be "default", covering every frame.',
    ],
    [
      'a default section ending early',
      animFile({
        ...TWO_FRAMES,
        sectionRecords: [{ name: 'default', start: 0, end: 0 }],
      }),
      'The first section must be "default", covering every frame.',
    ],
    [
      'a default section ending past the last frame',
      animFile({
        ...ONE_PIXEL,
        sectionRecords: [{ name: 'default', start: 0, end: 1 }],
      }),
      'Section 0 is invalid.',
    ],
    [
      'a frame header past the end of the file',
      animFile({ ...ONE_PIXEL, frameCount: 2 }),
      'Frame 1 lies outside the file.',
    ],
    [
      'frame data past the end of the file',
      withFrame({
        mask: MASK_ALL,
        pixels: RAW,
        data: [0, 0, 0],
        pixelLength: 7,
      }),
      'Frame 0 lies outside the file.',
    ],
    [
      'an unknown mask encoding',
      withFrame({ mask: 5, pixels: RAW }),
      'Unknown mask encoding 5.',
    ],
    [
      'an unknown pixel encoding',
      withFrame({ mask: MASK_ALL, pixels: 3 }),
      'Unknown pixel encoding 3.',
    ],
    [
      'QOI pixels in a grey animation',
      withFrame({ mask: MASK_ALL, pixels: QOI, data: [0xc1] }, GRAY4),
      'Grey animations cannot use QOI pixels.',
    ],
    [
      'a mask too short for a run',
      withFrame({ mask: MASK_RUNS_ABSENT_FIRST, pixels: RAW, maskBits: '01' }),
      'A mask run is cut short.',
    ],
    [
      'a long run cut short',
      withFrame({
        mask: MASK_RUNS_ABSENT_FIRST,
        pixels: RAW,
        maskBits: '111 0000',
      }),
      'A mask run is cut short.',
    ],
    [
      'QOI data ending inside an op',
      withFrame({ mask: MASK_ALL, pixels: QOI, data: [0xfe, 1, 2] }),
      'QOI pixels end early.',
    ],
    [
      'QOI data ending before the last pixel',
      withFrame({ mask: MASK_ALL, pixels: QOI, data: [0xfe, 1, 2, 3] }),
      'Frame 0 holds 1 pixels for 2 places.',
    ],
    [
      'raw pixels short of the mask',
      withFrame({ mask: MASK_ALL, pixels: RAW, data: [1, 2, 3] }),
      'Frame 0 holds 1 pixels for 2 places.',
    ],
    [
      'raw pixels past the mask',
      withFrame({
        mask: MASK_ALL,
        pixels: RAW,
        data: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      }),
      'Frame 0 holds 3 pixels for 2 places.',
    ],
    [
      'QOI pixels past the mask',
      withFrame({ mask: MASK_ALL, pixels: QOI, data: [0xc2] }),
      'Frame 0 holds 3 pixels for 2 places.',
    ],
    [
      'grey pixels past the padding nibble',
      withFrame({ mask: MASK_ALL, pixels: RAW, data: [0x12, 0x34] }, GRAY4),
      'Frame 0 holds 4 pixels for 2 places.',
    ],
  ])('rejects %s', (_name, bytes, message) => {
    expect(() => readAnimFile(bytes)).toThrow(AnimationError);
    expect(() => readAnimFile(bytes)).toThrow(message);
  });
});
