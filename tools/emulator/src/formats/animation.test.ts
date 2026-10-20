import { describe, expect, it } from 'vitest';

import { png, solidPng, zip } from '../__tests__/fixtures.ts';
import { AnimationError, DEFAULT_FPS, readAnimation } from './animation.ts';

const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

/** A one-row RGBA PNG of the given pixels. */
function rowPng(...pixels: readonly (readonly number[])[]): Uint8Array {
  return png({
    width: pixels.length,
    height: 1,
    bitDepth: 8,
    colorType: 6,
    data: Uint8Array.from([0, ...pixels.flat()]),
  });
}

describe('readAnimation', () => {
  it('orders frames by the number in their names and reads meta.json', () => {
    const animation = readAnimation(
      zip([
        { name: 'wave_2x1/', data: new Uint8Array(0), method: 0 },
        {
          name: 'wave_2x1/frame_10.png',
          data: solidPng(2, 1, [0, 0, 255, 255]),
        },
        {
          name: 'wave_2x1/frame_9.PNG',
          data: solidPng(2, 1, [0, 255, 0, 255]),
        },
        {
          name: 'wave_2x1/frame_0.png',
          data: solidPng(2, 1, [255, 0, 0, 255]),
        },
        { name: 'wave_2x1/._frame_0.png', data: new Uint8Array(3) },
        { name: 'wave_2x1/frame_5.gif', data: new Uint8Array(3) },
        { name: 'wave_2x1/notes.txt', data: new Uint8Array(3) },
        {
          name: 'wave_2x1/meta.json',
          data: json({
            fps: 24,
            sections: [
              { name: 'idle', start: 1, end: 2 },
              { name: 'too-far', start: 0, end: 3 },
              { name: 'backwards', start: 2, end: 1 },
              { name: 'before-the-start', start: -1, end: 1 },
              { name: 'unnumbered', start: '0', end: 1 },
              { name: 'no-start', end: 1 },
              { name: 'no-end', start: 1 },
              { start: 0, end: 0 },
              { name: 7, start: 0, end: 0 },
              'junk',
              null,
            ],
          }),
        },
      ]),
    );

    expect(animation.width).toBe(2);
    expect(animation.height).toBe(1);
    expect(animation.fps).toBe(24);
    expect(
      animation.frames.map((frame) => Array.from(frame.rgba.subarray(0, 3))),
    ).toStrictEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    expect([...animation.sections]).toStrictEqual([
      ['idle', { start: 1, end: 2 }],
    ]);
  });

  it('orders frames by the last number in their names', () => {
    const animation = readAnimation(
      zip([
        { name: 'a/coding_72x16_10.png', data: solidPng(1, 1, [3, 3, 3, 255]) },
        { name: 'a/coding_72x16_2.png', data: solidPng(1, 1, [2, 2, 2, 255]) },
        { name: 'a/coding_72x16_1.png', data: solidPng(1, 1, [1, 1, 1, 255]) },
      ]),
    );

    expect(animation.frames.map((frame) => frame.rgba[0])).toStrictEqual([
      1, 2, 3,
    ]);
  });

  it.each([
    [
      'rgb888',
      'keeps the colour and makes every pixel opaque',
      [
        [0x9c, 20, 30, 255],
        [0xcf, 100, 50, 255],
      ],
    ],
    [
      'gray4',
      'makes opaque grey from the top four bits of red',
      [
        [0x90, 0x90, 0x90, 255],
        [0xc0, 0xc0, 0xc0, 255],
      ],
    ],
    [
      'argb8888',
      'keeps every pixel',
      [
        [0x9c, 20, 30, 40],
        [0xcf, 100, 50, 0],
      ],
    ],
  ])('reduces %s frames the way the converter does: %s', (mode, _how, rgba) => {
    const animation = readAnimation(
      zip([
        {
          name: 'a/frame_0.png',
          data: rowPng([0x9c, 20, 30, 40], [0xcf, 100, 50, 0]),
        },
        { name: 'a/meta.json', data: json({ color_mode: mode }) },
      ]),
    );

    expect(Array.from(animation.frames[0]?.rgba ?? [])).toStrictEqual(
      rgba.flat(),
    );
  });

  it.each([
    ['no colour mode', {}],
    ['an unknown colour mode', { color_mode: 'rgb565' }],
    ['a colour mode that is not a string', { color_mode: 2 }],
  ])('keeps every pixel with %s', (_name, meta) => {
    const animation = readAnimation(
      zip([
        { name: 'a/frame_0.png', data: rowPng([0x9c, 20, 30, 40]) },
        { name: 'a/meta.json', data: json(meta) },
      ]),
    );

    expect(Array.from(animation.frames[0]?.rgba ?? [])).toStrictEqual([
      0x9c, 20, 30, 40,
    ]);
  });

  it.each([
    ['without meta.json', []],
    ['without an fps', [{ name: 'a/meta.json', data: json({}) }]],
    ['at an fps of 0', [{ name: 'a/meta.json', data: json({ fps: 0 }) }]],
    ['at a negative fps', [{ name: 'a/meta.json', data: json({ fps: -5 }) }]],
    [
      'at an fps in a string',
      [{ name: 'a/meta.json', data: json({ fps: '24' }) }],
    ],
  ])('plays at the default rate %s', (_name, files) => {
    const frames = [
      { name: 'a/coding_00001.png', data: solidPng(1, 1, [1, 2, 3, 255]) },
    ];

    expect(readAnimation(zip([...frames, ...files])).fps).toBe(DEFAULT_FPS);
  });

  it('has no sections when meta.json lists none', () => {
    const animation = readAnimation(
      zip([
        { name: 'a/frame_0.png', data: solidPng(1, 1, [0, 0, 0, 255]) },
        {
          name: 'a/meta.json',
          data: json({ sections: { idle: { start: 0, end: 0 } } }),
        },
      ]),
    );

    expect(animation.sections.size).toBe(0);
  });

  it.each([
    [[{ name: 'a/meta.json', data: json({ fps: 30 }) }], 'holds no PNG frames'],
    [
      [
        { name: 'a/frame_0.png', data: solidPng(1, 1, [0, 0, 0, 255]) },
        { name: 'a/frame_1.png', data: solidPng(2, 1, [0, 0, 0, 255]) },
      ],
      'not all the same size',
    ],
    [
      [
        { name: 'a/frame_0.png', data: solidPng(1, 1, [0, 0, 0, 255]) },
        { name: 'a/meta.json', data: new TextEncoder().encode('{') },
      ],
      'meta.json is not valid JSON',
    ],
    [
      [
        { name: 'a/frame_0.png', data: solidPng(1, 1, [0, 0, 0, 255]) },
        { name: 'a/meta.json', data: json(5) },
      ],
      'does not hold an object',
    ],
    [
      [
        { name: 'a/frame_0.png', data: solidPng(1, 1, [0, 0, 0, 255]) },
        { name: 'a/meta.json', data: json(null) },
      ],
      'does not hold an object',
    ],
  ])('rejects archives it cannot play (%#)', (files, message) => {
    expect(() => readAnimation(zip(files))).toThrow(AnimationError);
    expect(() => readAnimation(zip(files))).toThrow(message);
  });

  it('treats a frame without a number as the first', () => {
    const animation = readAnimation(
      zip([
        { name: 'a/frame_1.png', data: solidPng(1, 1, [9, 9, 9, 255]) },
        { name: 'a/cover.png', data: solidPng(1, 1, [1, 1, 1, 255]) },
      ]),
    );

    expect(animation.frames[0]?.rgba[0]).toBe(1);
  });
});
