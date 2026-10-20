// PNG decoding and encoding with Node's zlib: enough for the bar's stock
// images, animation frames, uploaded images, and the emulator's screenshots.

import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** An image as 8-bit RGBA, rows top to bottom. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** The bytes are not a PNG this decoder can read. */
export class PngError extends Error {
  override readonly name = 'PngError';
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Samples per pixel for each PNG colour type.
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // greyscale
  2: 3, // RGB
  3: 1, // palette index
  4: 2, // greyscale and alpha
  6: 4, // RGBA
};

// Adam7 interlacing passes: x start, y start, x step, y step.
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Header {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly channels: number;
  readonly interlaced: boolean;
}

interface Chunks {
  readonly header: Header;
  readonly palette: Uint8Array | undefined;
  readonly transparency: Uint8Array | undefined;
  readonly data: Uint8Array;
}

/** Decode a PNG of any standard colour type, bit depth, or interlacing. */
export function decodePng(bytes: Uint8Array): Bitmap {
  const { header, palette, transparency, data } = readChunks(bytes);
  if (header.colorType === 3 && palette === undefined) {
    throw new PngError('The PNG uses a palette but has no PLTE chunk.');
  }
  const pixels = inflate(data);
  const rgba = new Uint8Array(header.width * header.height * 4);
  const passes = header.interlaced
    ? ADAM7
    : ([[0, 0, 1, 1]] as const satisfies readonly (readonly number[])[]);
  let offset = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const width = Math.ceil((header.width - x0) / dx);
    const height = Math.ceil((header.height - y0) / dy);
    if (width <= 0 || height <= 0) {
      continue;
    }
    const rowBytes = Math.ceil((width * header.channels * header.bitDepth) / 8);
    const rows = unfilter(pixels, offset, width, height, rowBytes, header);
    offset += height * (rowBytes + 1);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x += 1) {
        const at = ((y0 + y * dy) * header.width + x0 + x * dx) * 4;
        writePixel(rgba, at, row, x, header, palette, transparency);
      }
    });
  }
  return { width: header.width, height: header.height, rgba };
}

/** Encode RGBA pixels as a PNG, unfiltered and deflated. */
export function encodePng(bitmap: Bitmap): Uint8Array {
  const { width, height, rgba } = bitmap;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  }
  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function readChunks(bytes: Uint8Array): Chunks {
  if (
    bytes.length < SIGNATURE.length ||
    SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw new PngError('Not a PNG file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const data: Uint8Array[] = [];
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) {
      throw new PngError('The PNG file is truncated.');
    }
    const body = bytes.subarray(start, end);
    if (type === 'IHDR') {
      header = readHeader(body);
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      transparency = body;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (header === undefined) {
    throw new PngError('The PNG file has no IHDR chunk.');
  }
  return { header, palette, transparency, data: concat(data) };
}

function readHeader(body: Uint8Array): Header {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = body[8] ?? 0;
  const colorType = body[9] ?? 0;
  const channels = CHANNELS[colorType];
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(bitDepth)) {
    throw new PngError(
      `Unsupported PNG colour type ${colorType} at bit depth ${bitDepth}.`,
    );
  }
  if (width === 0 || height === 0) {
    throw new PngError('The PNG has no pixels.');
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    channels,
    interlaced: body[12] === 1,
  };
}

function inflate(data: Uint8Array): Uint8Array {
  try {
    return inflateSync(data);
  } catch (error) {
    throw new PngError('The PNG image data is corrupt.', { cause: error });
  }
}

/** Undo the per-row filters of one (sub-)image and return its rows. */
function unfilter(
  pixels: Uint8Array,
  offset: number,
  width: number,
  height: number,
  rowBytes: number,
  header: Header,
): Uint8Array[] {
  const bytesPerPixel = Math.max(
    1,
    Math.ceil((header.channels * header.bitDepth) / 8),
  );
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const start = offset + y * (rowBytes + 1);
    if (start + rowBytes + 1 > pixels.length) {
      throw new PngError(
        `The PNG image data ends early for ${width}x${height}.`,
      );
    }
    const filter = pixels[start] ?? 0;
    const row = pixels.slice(start + 1, start + 1 + rowBytes);
    for (let i = 0; i < rowBytes; i += 1) {
      const left = i >= bytesPerPixel ? (row[i - bytesPerPixel] ?? 0) : 0;
      const up = previous[i] ?? 0;
      const upLeft =
        i >= bytesPerPixel ? (previous[i - bytesPerPixel] ?? 0) : 0;
      row[i] = ((row[i] ?? 0) + predictor(filter, left, up, upLeft)) & 0xff;
    }
    rows.push(row);
    previous = row;
  }
  return rows;
}

function predictor(
  filter: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) {
        return left;
      }
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new PngError(`Unknown PNG filter type ${filter}.`);
  }
}

/** The raw value of one sample, at the file's bit depth. */
function sample(
  row: Uint8Array,
  x: number,
  channel: number,
  header: Header,
): number {
  const { bitDepth, channels } = header;
  if (bitDepth === 16) {
    const at = (x * channels + channel) * 2;
    return ((row[at] ?? 0) << 8) | (row[at + 1] ?? 0);
  }
  if (bitDepth === 8) {
    return row[x * channels + channel] ?? 0;
  }
  const bit = (x * channels + channel) * bitDepth;
  const shift = 8 - bitDepth - (bit & 7);
  return ((row[bit >> 3] ?? 0) >> shift) & ((1 << bitDepth) - 1);
}

function writePixel(
  rgba: Uint8Array,
  at: number,
  row: Uint8Array,
  x: number,
  header: Header,
  palette: Uint8Array | undefined,
  transparency: Uint8Array | undefined,
): void {
  const max = (1 << header.bitDepth) - 1;
  const scale = (value: number): number => Math.round((value * 255) / max);
  const raw = (channel: number): number => sample(row, x, channel, header);
  let red: number;
  let green: number;
  let blue: number;
  let alpha = 255;
  switch (header.colorType) {
    case 3: {
      const index = raw(0);
      red = palette?.[index * 3] ?? 0;
      green = palette?.[index * 3 + 1] ?? 0;
      blue = palette?.[index * 3 + 2] ?? 0;
      alpha = transparency?.[index] ?? 255;
      break;
    }
    case 0:
    case 4: {
      const grey = raw(0);
      red = green = blue = scale(grey);
      if (header.colorType === 4) {
        alpha = scale(raw(1));
      } else if (
        transparency !== undefined &&
        grey === readUint16(transparency, 0)
      ) {
        alpha = 0;
      }
      break;
    }
    default: {
      const [r, g, b] = [raw(0), raw(1), raw(2)];
      red = scale(r);
      green = scale(g);
      blue = scale(b);
      if (header.colorType === 6) {
        alpha = scale(raw(3));
      } else if (
        transparency !== undefined &&
        r === readUint16(transparency, 0) &&
        g === readUint16(transparency, 2) &&
        b === readUint16(transparency, 4)
      ) {
        alpha = 0;
      }
    }
  }
  rgba[at] = red;
  rgba[at + 1] = green;
  rgba[at + 2] = blue;
  rgba[at + 3] = alpha;
}

function readUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
