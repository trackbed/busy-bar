import { describe, expect, it } from 'vitest';

import { png } from '../__tests__/fixtures.ts';
import { decodePng, encodePng, PngError } from './png.ts';

function pixels(decoded: { rgba: Uint8Array }): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < decoded.rgba.length; i += 4) {
    out.push(Array.from(decoded.rgba.subarray(i, i + 4)));
  }
  return out;
}

/** Apply PNG filter `type` to `rows` of RGB bytes (3 bytes per pixel). */
function filtered(type: number, rows: number[][]): Uint8Array {
  const out: number[] = [];
  let previous: number[] = Array.from(
    { length: rows[0]?.length ?? 0 },
    () => 0,
  );
  for (const row of rows) {
    out.push(type);
    row.forEach((value, i) => {
      const left = i >= 3 ? (row[i - 3] ?? 0) : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= 3 ? (previous[i - 3] ?? 0) : 0;
      let prediction = 0;
      if (type === 1) {
        prediction = left;
      } else if (type === 2) {
        prediction = up;
      } else if (type === 3) {
        prediction = (left + up) >> 1;
      } else if (type === 4) {
        const estimate = left + up - upLeft;
        const [a, b, c] = [
          Math.abs(estimate - left),
          Math.abs(estimate - up),
          Math.abs(estimate - upLeft),
        ];
        prediction = a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      out.push((value - prediction) & 0xff);
    });
    previous = row;
  }
  return Uint8Array.from(out);
}

const RGB_ROWS = [
  [10, 20, 30, 200, 100, 50, 255, 255, 255],
  [0, 0, 0, 90, 180, 240, 33, 66, 99],
];
const RGB_PIXELS = [
  [10, 20, 30, 255],
  [200, 100, 50, 255],
  [255, 255, 255, 255],
  [0, 0, 0, 255],
  [90, 180, 240, 255],
  [33, 66, 99, 255],
];

describe('decodePng', () => {
  it('round-trips what encodePng writes', () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 9,
    ]);

    const decoded = decodePng(encodePng({ width: 2, height: 2, rgba }));

    expect(decoded).toStrictEqual({ width: 2, height: 2, rgba });
  });

  it.each([0, 1, 2, 3, 4])('undoes filter type %d', (filter) => {
    const decoded = decodePng(
      png({
        width: 3,
        height: 2,
        bitDepth: 8,
        colorType: 2,
        data: filtered(filter, RGB_ROWS),
      }),
    );

    expect(pixels(decoded)).toStrictEqual(RGB_PIXELS);
  });

  it('reads greyscale with a transparent grey', () => {
    const decoded = decodePng(
      png({
        width: 2,
        height: 1,
        bitDepth: 8,
        colorType: 0,
        data: Uint8Array.from([0, 64, 200]),
        transparency: [0, 200],
      }),
    );

    expect(pixels(decoded)).toStrictEqual([
      [64, 64, 64, 255],
      [200, 200, 200, 0],
    ]);
  });

  it('reads 2-bit palette images with per-entry alpha', () => {
    const decoded = decodePng(
      png({
        width: 4,
        height: 1,
        bitDepth: 2,
        colorType: 3,
        // Indices 0, 1, 2, 3 packed into one byte.
        data: Uint8Array.from([0, 0b00_01_10_11]),
        palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9],
        transparency: [255, 128],
      }),
    );

    expect(pixels(decoded)).toStrictEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 255],
      [9, 9, 9, 255],
    ]);
  });

  it('reads 1-bit greyscale', () => {
    const decoded = decodePng(
      png({
        width: 3,
        height: 1,
        bitDepth: 1,
        colorType: 0,
        data: Uint8Array.from([0, 0b1010_0000]),
      }),
    );

    expect(pixels(decoded).map(([grey]) => grey)).toStrictEqual([255, 0, 255]);
  });

  it('reads 16-bit RGB with a transparent colour, keeping the high bytes', () => {
    const decoded = decodePng(
      png({
        width: 2,
        height: 1,
        bitDepth: 16,
        colorType: 2,
        data: Uint8Array.from([
          0, 0xff, 0xff, 0x80, 0x00, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78, 0x9a,
          0xbc,
        ]),
        transparency: [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc],
      }),
    );

    expect(pixels(decoded)).toStrictEqual([
      [255, 128, 0, 255],
      [18, 86, 154, 0],
    ]);
  });

  it('reads greyscale with alpha and RGBA', () => {
    const grey = decodePng(
      png({
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 4,
        data: Uint8Array.from([0, 100, 50]),
      }),
    );
    const colour = decodePng(
      png({
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 6,
        data: Uint8Array.from([0, 1, 2, 3, 4]),
      }),
    );

    expect(pixels(grey)).toStrictEqual([[100, 100, 100, 50]]);
    expect(pixels(colour)).toStrictEqual([[1, 2, 3, 4]]);
  });

  it('reads Adam7-interlaced images', () => {
    // A 3x3 greyscale image whose pixel values are 10 * (y * 3 + x).
    // Passes 1, 4, 5, 6 and 7 hold (0,0); (2,0); (0,2) (2,2); (1,0) (1,2); (0,1) (1,1) (2,1).
    const data = Uint8Array.from([
      0,
      0, // pass 1: (0,0)
      0,
      20, // pass 4: (2,0)
      0,
      60,
      80, // pass 5: (0,2) (2,2)
      0,
      10,
      0,
      70, // pass 6: (1,0), then (1,2)
      0,
      30,
      40,
      50, // pass 7: row 1
    ]);

    const decoded = decodePng(
      png({
        width: 3,
        height: 3,
        bitDepth: 8,
        colorType: 0,
        interlaced: true,
        data,
      }),
    );

    expect(pixels(decoded).map(([grey]) => grey)).toStrictEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80,
    ]);
  });

  it.each([
    [Uint8Array.from([1, 2, 3]), 'Not a PNG file.'],
    [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72]),
      'no IHDR',
    ],
  ])('rejects bytes that are not a PNG (%#)', (bytes, message) => {
    expect(() => decodePng(bytes)).toThrow(PngError);
    expect(() => decodePng(bytes)).toThrow(message);
  });

  it('rejects a truncated chunk', () => {
    const whole = encodePng({ width: 1, height: 1, rgba: new Uint8Array(4) });

    expect(() => decodePng(whole.subarray(0, 30))).toThrow('truncated');
  });

  it.each([
    [
      {
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 5,
        data: new Uint8Array(2),
      },
      'Unsupported PNG colour type 5',
    ],
    [
      {
        width: 0,
        height: 1,
        bitDepth: 8,
        colorType: 0,
        data: new Uint8Array(1),
      },
      'no pixels',
    ],
    [
      {
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 3,
        data: new Uint8Array(2),
      },
      'no PLTE',
    ],
    [
      {
        width: 1,
        height: 1,
        bitDepth: 8,
        colorType: 0,
        data: Uint8Array.from([9, 0]),
      },
      'Unknown PNG filter type 9',
    ],
    [
      {
        width: 4,
        height: 4,
        bitDepth: 8,
        colorType: 0,
        data: Uint8Array.from([0, 1]),
      },
      'ends early',
    ],
  ])('rejects images it cannot decode (%#)', (parts, message) => {
    expect(() => decodePng(png(parts))).toThrow(message);
  });

  it('rejects corrupt image data', () => {
    const bytes = png({
      width: 1,
      height: 1,
      bitDepth: 8,
      colorType: 0,
      data: Uint8Array.from([0, 1]),
    });
    // Overwrite the start of the deflate stream inside the IDAT chunk.
    const idat = bytes.findIndex(
      (_, i) =>
        bytes[i] === 73 &&
        bytes[i + 1] === 68 &&
        bytes[i + 2] === 65 &&
        bytes[i + 3] === 84,
    );
    bytes.set([0xff, 0xff, 0xff], idat + 4);

    expect(() => decodePng(bytes)).toThrow('corrupt');
  });
});
