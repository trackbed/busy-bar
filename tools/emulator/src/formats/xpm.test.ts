import { describe, expect, it } from 'vitest';

import { parseXpm, XpmError } from './xpm.ts';

const FRONT = { width: 72, height: 16 };
const BACK = { width: 160, height: 80 };

const xpm = (...lines: string[]): string => ['! XPM2', ...lines].join('\n');

function pixels(bitmap: { rgba: Uint8Array }): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < bitmap.rgba.length; i += 4) {
    out.push(Array.from(bitmap.rgba.subarray(i, i + 4)));
  }
  return out;
}

describe('parseXpm', () => {
  it('decodes colours, names, transparency, and multi-character pixels', () => {
    const bitmap = parseXpm(
      xpm('3 1 3 2', 'aa c #FF0000', 'bb c None', 'cc c #00f', 'aabbcc'),
      'front',
      FRONT,
    );

    expect(bitmap.width).toBe(3);
    expect(pixels(bitmap)).toStrictEqual([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
      [0, 0, 255, 255],
    ]);
  });

  it('scales 4-digit channels and reads a space as a pixel character', () => {
    const bitmap = parseXpm(
      xpm('2 1 2 1', '  c #ffff00000000', 'x c grey', ' x'),
      'front',
      FRONT,
    );

    expect(pixels(bitmap)).toStrictEqual([
      [255, 0, 0, 255],
      [128, 128, 128, 255],
    ]);
  });

  it('prefers grey keys on the back and turns colours into luma there', () => {
    const data = xpm('2 1 2 1', 'a c #FF0000 g #404040', 'b c #00FF00', 'ab');

    expect(pixels(parseXpm(data, 'front', FRONT))).toStrictEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    // Green's luma is (150 * 255) >> 8.
    expect(pixels(parseXpm(data, 'back', BACK))).toStrictEqual([
      [64, 64, 64, 255],
      [149, 149, 149, 255],
    ]);
  });

  it.each(['constructor', '__proto__'])(
    'rejects inherited color name %s on both displays',
    (name) => {
      const data = xpm('1 1 1 1', `a c ${name}`, 'a');

      for (const display of ['front', 'back'] as const) {
        expect(() => parseXpm(data, display, FRONT)).toThrow(XpmError);
        expect(() => parseXpm(data, display, FRONT)).toThrow(
          'have valid XPM color table',
        );
      }
    },
  );

  it.each([
    ['XPM2\n1 1 1 1\na c red\na', 'have valid XPM header'],
    [xpm('1 1 one 1', 'a c red', 'a'), 'have valid XPM header'],
    [xpm('1 1 1'), 'have valid XPM header'],
    [xpm('1 1 33 1'), 'have <= 32 colors and <= 4 chars per pixel'],
    [xpm('1 1 1 5'), 'have <= 32 colors and <= 4 chars per pixel'],
    [xpm('73 1 1 1'), 'be no larger than the display (72x16)'],
    [xpm('1 1 1 1', 'a c chartreuse', 'a'), 'have valid XPM color table'],
    [xpm('1 1 1 1', 'a s icon', 'a'), 'have valid XPM color table'],
    [xpm('1 1 2 1', 'a c red'), 'have valid XPM color table'],
    [xpm('2 1 1 1', 'a c red', 'a'), 'have valid XPM pixel data'],
    [xpm('1 1 1 1', 'a c red', 'b'), 'have valid XPM pixel data'],
  ])('rejects %j', (data, rule) => {
    expect(() => parseXpm(data, 'front', FRONT)).toThrow(XpmError);
    expect(() => parseXpm(data, 'front', FRONT)).toThrow(rule);
  });
});
