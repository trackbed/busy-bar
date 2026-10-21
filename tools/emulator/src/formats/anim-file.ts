// The bar's own animation files (`.anim`, signature "bicycle1"), which apps
// upload and the firmware's lib/anim_file plays: a header, named sections,
// then frames that each update the pixels a mask marks, encoded raw,
// run-length, or in a QOI-like scheme.

import type { Animation, Section } from './animation.ts';
import { AnimationError } from './animation.ts';
import { byteAt } from './bytes.ts';
import type { Bitmap } from './png.ts';
import { decodeRle } from './rle.ts';

const SIGNATURE = 'bicycle1';
const HEADER_BYTES = 34;
const FRAME_HEADER_BYTES = 5;

type ColorFormat = 'bgr888' | 'gray4' | 'bgra8888';
const COLOR_FORMATS: readonly ColorFormat[] = ['bgr888', 'gray4', 'bgra8888'];
// The run-length block of each format: one pixel, or two grey pixels.
const BLOCK_BYTES: Readonly<Record<ColorFormat, number>> = {
  bgr888: 3,
  gray4: 1,
  bgra8888: 4,
};

/** Decode an `.anim` file into full RGBA frames. */
export function readAnimFile(bytes: Uint8Array): Animation {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < HEADER_BYTES ||
    String.fromCharCode(...bytes.subarray(0, 8)) !== SIGNATURE
  ) {
    throw new AnimationError('Not a bicycle1 animation file.');
  }
  const width = view.getUint8(9);
  const height = view.getUint8(10);
  const format = COLOR_FORMATS[view.getUint8(11)];
  const fps = view.getUint8(16);
  const sectionsLength = view.getUint32(18, true);
  const framesLength = view.getUint32(22, true);
  const sectionCount = view.getUint32(26, true);
  const frameCount = view.getUint32(30, true);
  if (
    view.getUint8(8) !== 0 ||
    format === undefined ||
    width === 0 ||
    height === 0 ||
    fps === 0 ||
    sectionCount === 0 ||
    frameCount === 0 ||
    bytes.length !== HEADER_BYTES + sectionsLength + framesLength
  ) {
    throw new AnimationError('The animation header is invalid.');
  }
  const sections = readSections(
    bytes.subarray(0, HEADER_BYTES + sectionsLength),
    view,
    sectionCount,
    frameCount,
  );
  const frames: Bitmap[] = [];
  // B, G, R, A per pixel, kept between frames: a frame only changes the
  // pixels its mask marks.
  const bgra = new Uint8Array(width * height * 4);
  let at = HEADER_BYTES + sectionsLength;
  for (let index = 0; index < frameCount; index += 1) {
    if (at + FRAME_HEADER_BYTES > bytes.length) {
      throw new AnimationError(`Frame ${index} lies outside the file.`);
    }
    const encoding = view.getUint8(at);
    const maskBits = view.getUint16(at + 1, true);
    const pixelBytes = view.getUint16(at + 3, true);
    const maskStart = at + FRAME_HEADER_BYTES;
    const pixelStart = maskStart + Math.ceil(maskBits / 8);
    const end = pixelStart + pixelBytes;
    if (end > bytes.length) {
      throw new AnimationError(`Frame ${index} lies outside the file.`);
    }
    const present = readMask(
      encoding >> 4,
      bytes.subarray(maskStart, pixelStart),
      maskBits,
      width * height,
    );
    const pixels = readPixels(
      encoding & 0x0f,
      bytes.subarray(pixelStart, end),
      format,
    );
    // As in the firmware's dispersion step: the pixels must fill exactly the
    // places the mask marks, but for a grey frame's padding nibble.
    const spare = pixels.length / 4 - present.length;
    if (spare < 0 || spare > (format === 'gray4' ? 1 : 0)) {
      throw new AnimationError(
        `Frame ${index} holds ${pixels.length / 4} pixels for ${present.length} places.`,
      );
    }
    present.forEach((pixel, order) => {
      bgra.set(pixels.subarray(order * 4, order * 4 + 4), pixel * 4);
    });
    frames.push(toRgba(bgra, width, height));
    at = end;
  }
  return { width, height, fps, frames, sections };
}

/**
 * The section records. `bytes` ends with the sections chunk, so a record
 * and the NUL ending its name must both lie inside it.
 */
function readSections(
  bytes: Uint8Array,
  view: DataView,
  count: number,
  frameCount: number,
): Map<string, Section> {
  const sections = new Map<string, Section>();
  let at = HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    const nameEnd = bytes.indexOf(0, at + 12);
    if (nameEnd === -1) {
      throw new AnimationError('The section table is cut short.');
    }
    const start = view.getUint32(at, true);
    const end = view.getUint32(at + 4, true);
    if (start > end || end >= frameCount) {
      throw new AnimationError(`Section ${index} is invalid.`);
    }
    const name = new TextDecoder().decode(bytes.subarray(at + 12, nameEnd));
    if (
      index === 0 &&
      (name !== 'default' || start !== 0 || end !== frameCount - 1)
    ) {
      throw new AnimationError(
        'The first section must be "default", covering every frame.',
      );
    }
    sections.set(name, { start, end });
    at = nameEnd + 1;
  }
  return sections;
}

/** The pixel indexes, in raster order, that a frame's pixel data fills. */
function readMask(
  encoding: number,
  data: Uint8Array,
  bits: number,
  size: number,
): number[] {
  switch (encoding) {
    case 0:
      return [];
    case 1:
      return Array.from({ length: size }, (_, pixel) => pixel);
    case 2:
    case 3: {
      // Alternating runs, the first absent (2) or present (3): three bits,
      // or seven followed by an eight-bit length.
      const reader = new BitReader(data, bits);
      const present: number[] = [];
      let pixel = 0;
      let on = encoding === 3;
      while (!reader.done) {
        let run = reader.read(3);
        if (run === 7) {
          run = reader.read(8);
        }
        if (on) {
          for (let i = 0; i < run; i += 1) {
            present.push(pixel + i);
          }
        }
        pixel += run;
        on = !on;
      }
      return present.filter((index) => index < size);
    }
    case 4:
      return Array.from({ length: size }, (_, pixel) => pixel).filter(
        (pixel) => ((byteAt(data, pixel >> 3) >> (7 - (pixel & 7))) & 1) === 1,
      );
    default:
      throw new AnimationError(`Unknown mask encoding ${encoding}.`);
  }
}

/** Every pixel a frame's data holds, as B, G, R, A bytes. */
function readPixels(
  encoding: number,
  data: Uint8Array,
  format: ColorFormat,
): Uint8Array {
  if (encoding === 2) {
    if (format === 'gray4') {
      throw new AnimationError('Grey animations cannot use QOI pixels.');
    }
    return readQoi(data);
  }
  if (encoding === 0) {
    return unpack(data, format);
  }
  if (encoding === 1) {
    return unpack(decodeRle(data, BLOCK_BYTES[format]), format);
  }
  throw new AnimationError(`Unknown pixel encoding ${encoding}.`);
}

/**
 * Raw pixels as B, G, R, A: BGR888 gains an opaque alpha, and each Gray4
 * byte holds two pixels, high nibble first, as grey `nibble << 4`.
 */
function unpack(raw: Uint8Array, format: ColorFormat): Uint8Array {
  if (format === 'bgra8888') {
    return raw.subarray(0, raw.length - (raw.length % 4));
  }
  if (format === 'gray4') {
    const out = new Uint8Array(raw.length * 8);
    raw.forEach((byte, index) => {
      const high = byte & 0xf0;
      const low = (byte & 0x0f) << 4;
      out.set([high, high, high, 255, low, low, low, 255], index * 8);
    });
    return out;
  }
  const count = Math.floor(raw.length / 3);
  const out = new Uint8Array(count * 4).fill(255);
  for (let pixel = 0; pixel < count; pixel += 1) {
    out.set(raw.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
  }
  return out;
}

/**
 * The QOI-like scheme for colour frames: ops reference a 64-entry colour
 * table, small differences, or runs, starting from opaque black. Every op
 * in the data counts, as in the firmware.
 */
function readQoi(data: Uint8Array): Uint8Array {
  const table = new Uint8Array(64 * 4);
  const out: number[] = [];
  let [r, g, b, a] = [0, 0, 0, 255];
  let at = 0;
  const next = (): number => {
    if (at >= data.length) {
      throw new AnimationError('QOI pixels end early.');
    }
    at += 1;
    return byteAt(data, at - 1);
  };
  while (at < data.length) {
    const op = next();
    let run = 1;
    if (op === 0xfe) {
      [r, g, b] = [next(), next(), next()];
    } else if (op === 0xff) {
      [r, g, b, a] = [next(), next(), next(), next()];
    } else if (op >> 6 === 0) {
      const entry = (op & 0x3f) * 4;
      [r, g, b, a] = [
        byteAt(table, entry),
        byteAt(table, entry + 1),
        byteAt(table, entry + 2),
        byteAt(table, entry + 3),
      ];
    } else if (op >> 6 === 1) {
      r = (r + ((op >> 4) & 3) - 2) & 0xff;
      g = (g + ((op >> 2) & 3) - 2) & 0xff;
      b = (b + (op & 3) - 2) & 0xff;
    } else if (op >> 6 === 2) {
      const second = next();
      const dg = (op & 0x3f) - 32;
      r = (r + dg + (second >> 4) - 8) & 0xff;
      g = (g + dg) & 0xff;
      b = (b + dg + (second & 0x0f) - 8) & 0xff;
    } else {
      run = (op & 0x3f) + 1;
    }
    table.set([r, g, b, a], ((r * 3 + g * 5 + b * 7 + a * 11) % 64) * 4);
    for (; run > 0; run -= 1) {
      out.push(b, g, r, a);
    }
  }
  return Uint8Array.from(out);
}

function toRgba(bgra: Uint8Array, width: number, height: number): Bitmap {
  const rgba = new Uint8Array(bgra.length);
  for (let at = 0; at < bgra.length; at += 4) {
    rgba[at] = byteAt(bgra, at + 2);
    rgba[at + 1] = byteAt(bgra, at + 1);
    rgba[at + 2] = byteAt(bgra, at);
    rgba[at + 3] = byteAt(bgra, at + 3);
  }
  return { width, height, rgba };
}

/** Reads exactly `bits` bits, most significant first. */
class BitReader {
  readonly #data: Uint8Array;
  readonly #bits: number;
  #at = 0;

  constructor(data: Uint8Array, bits: number) {
    this.#data = data;
    this.#bits = bits;
  }

  get done(): boolean {
    return this.#at >= this.#bits;
  }

  read(count: number): number {
    if (this.#at + count > this.#bits) {
      throw new AnimationError('A mask run is cut short.');
    }
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = byteAt(this.#data, this.#at >> 3);
      value = value * 2 + ((byte >> (7 - (this.#at & 7))) & 1);
      this.#at += 1;
    }
    return value;
  }
}
