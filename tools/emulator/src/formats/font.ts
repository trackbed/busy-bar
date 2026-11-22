// The bar's fonts, in LVGL's binary font format (`lv_font_conv --format
// bin`, read by LVGL's lv_binfont_loader.c): a `head` table, then `cmap`,
// `loca`, `glyf` and an optional `kern` table, each starting with its
// length and a four-letter tag. Glyph metrics follow lv_font_fmt_txt.c.

import { BitReader } from './bytes.ts';

/** The file is not a font this decoder reads. */
export class FontError extends Error {
  override readonly name = 'FontError';
}

/** One glyph's box and coverage, as LVGL's glyph descriptor holds them. */
export interface Glyph {
  /** The advance in 1/16 pixel. */
  readonly advance16: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  /** `width * height` coverage values, 0 to 255, rows top to bottom. */
  readonly coverage: Uint8Array;
}

type Cmap =
  | {
      readonly kind: 'tiny';
      readonly start: number;
      readonly length: number;
      readonly firstId: number;
    }
  | {
      readonly kind: 'full';
      readonly start: number;
      readonly length: number;
      readonly firstId: number;
      readonly offsets: Uint8Array;
    }
  | {
      readonly kind: 'sparse';
      readonly start: number;
      readonly length: number;
      readonly firstId: number;
      /** Glyph id offsets by code point offset. */
      readonly ids: ReadonlyMap<number, number>;
    };

/** Kerning values in 1/16 pixel before scaling, keyed by `pairKey`. */
type Kerning = ReadonlyMap<number, number>;

/** A decoded font: metrics, a code point lookup, glyphs and kerning. */
export class Font {
  readonly lineHeight: number;
  /** Pixels from the bottom of a line up to the baseline. */
  readonly baseLine: number;
  readonly #cmaps: readonly Cmap[];
  readonly #glyphs: readonly Glyph[];
  readonly #kerning: Kerning | undefined;
  readonly #kernScale: number;

  constructor(parts: {
    readonly lineHeight: number;
    readonly baseLine: number;
    readonly cmaps: readonly Cmap[];
    readonly glyphs: readonly Glyph[];
    readonly kerning: Kerning | undefined;
    readonly kernScale: number;
  }) {
    this.lineHeight = parts.lineHeight;
    this.baseLine = parts.baseLine;
    this.#cmaps = parts.cmaps;
    this.#glyphs = parts.glyphs;
    this.#kerning = parts.kerning;
    this.#kernScale = parts.kernScale;
  }

  /** The glyph for a code point, or undefined when the font lacks it. */
  glyph(codePoint: number): Glyph | undefined {
    const id = this.#glyphId(codePoint);
    return id === 0 ? undefined : this.#glyphs[id];
  }

  /**
   * How far the pen moves after `codePoint` when `next` follows, in whole
   * pixels, kerning included. A missing glyph advances like LVGL's
   * placeholder box: half the line height plus two.
   */
  advance(codePoint: number, next: number): number {
    const id = this.#glyphId(codePoint);
    const glyph = id === 0 ? undefined : this.#glyphs[id];
    if (glyph === undefined) {
      return placeholderWidth(this.lineHeight) + 2;
    }
    const nextId = this.#glyphId(next);
    const kern =
      nextId === 0 ? 0 : (this.#kern(id, nextId) * this.#kernScale) >> 4;
    return (glyph.advance16 + kern + 8) >> 4;
  }

  #glyphId(codePoint: number): number {
    if (codePoint === 0) {
      return 0;
    }
    for (const cmap of this.#cmaps) {
      const relative = codePoint - cmap.start;
      if (relative < 0 || relative >= cmap.length) {
        continue;
      }
      switch (cmap.kind) {
        case 'tiny':
          return cmap.firstId + relative;
        case 'full': {
          const offset = cmap.offsets[relative] ?? 0;
          // An offset of 0 past the first code point marks a missing glyph,
          // and LVGL then tries the next range.
          if (offset === 0 && relative !== 0) {
            continue;
          }
          return cmap.firstId + offset;
        }
        case 'sparse': {
          const offset = cmap.ids.get(relative);
          return offset === undefined ? 0 : cmap.firstId + offset;
        }
      }
    }
    return 0;
  }

  #kern(left: number, right: number): number {
    return this.#kerning?.get(pairKey(left, right)) ?? 0;
  }
}

function pairKey(left: number, right: number): number {
  return left * 0x10000 + right;
}

/** The width of LVGL's box for a glyph the font lacks. */
export function placeholderWidth(lineHeight: number): number {
  return Math.floor(lineHeight / 2);
}

/** Decode a `.font` file. */
export function readFont(bytes: Uint8Array): Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = table(view, 0, 'head');
  const at = (offset: number): number => head.start + 8 + offset;
  const ascent = u16(view, at(8));
  const descent = view.getInt16(at(10), true);
  const header = {
    defaultAdvance: u16(view, at(22)),
    kernScale: u16(view, at(24)),
    locFormat: view.getUint8(at(26)),
    idFormat: view.getUint8(at(27)),
    advanceFormat: view.getUint8(at(28)),
    bpp: view.getUint8(at(29)),
    xyBits: view.getUint8(at(30)),
    whBits: view.getUint8(at(31)),
    advanceBits: view.getUint8(at(32)),
    compression: view.getUint8(at(33)),
  };
  if (![1, 2, 4, 8].includes(header.bpp)) {
    throw new FontError(`Unsupported bits per pixel: ${header.bpp}.`);
  }
  if (header.compression !== 0) {
    throw new FontError('Compressed fonts are not supported.');
  }
  const cmapTable = table(view, head.end, 'cmap');
  const cmaps = readCmaps(view, cmapTable.start);
  const locaTable = table(view, cmapTable.end, 'loca');
  const count = u32(view, locaTable.start + 8);
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    offsets.push(
      header.locFormat === 0
        ? u16(view, locaTable.start + 12 + i * 2)
        : u32(view, locaTable.start + 12 + i * 4),
    );
  }
  const glyfTable = table(view, locaTable.end, 'glyf');
  const glyphs = offsets.map((offset, id) =>
    id === 0
      ? EMPTY_GLYPH
      : readGlyph(
          new BitReader(
            bytes,
            { from: (glyfTable.start + offset) * 8, to: bytes.length * 8 },
            () => new FontError('A glyph runs past the end of the file.'),
          ),
          header,
        ),
  );
  // The fourth table after the head, when there is one, holds kerning.
  const kerning =
    u16(view, at(4)) >= 4
      ? readKerning(
          view,
          table(view, glyfTable.end, 'kern').start,
          header.idFormat,
        )
      : undefined;
  return new Font({
    lineHeight: ascent - descent,
    baseLine: -descent,
    cmaps,
    glyphs,
    kerning,
    kernScale: kerning === undefined ? 0 : header.kernScale,
  });
}

const EMPTY_GLYPH: Glyph = {
  advance16: 0,
  offsetX: 0,
  offsetY: 0,
  width: 0,
  height: 0,
  coverage: new Uint8Array(0),
};

function table(
  view: DataView,
  start: number,
  tag: string,
): { start: number; end: number } {
  if (start + 8 > view.byteLength) {
    throw new FontError(`The ${tag} table is missing.`);
  }
  const length = u32(view, start);
  const found = String.fromCharCode(
    view.getUint8(start + 4),
    view.getUint8(start + 5),
    view.getUint8(start + 6),
    view.getUint8(start + 7),
  );
  if (found !== tag || length < 8 || start + length > view.byteLength) {
    throw new FontError(`Expected a ${tag} table at byte ${start}.`);
  }
  return { start, end: start + length };
}

function readCmaps(view: DataView, start: number): Cmap[] {
  const count = u32(view, start + 8);
  const cmaps: Cmap[] = [];
  for (let i = 0; i < count; i += 1) {
    const record = start + 12 + i * 16;
    const data = start + u32(view, record);
    const range = {
      start: u32(view, record + 4),
      length: u16(view, record + 8),
      firstId: u16(view, record + 10),
    };
    const entries = u16(view, record + 12);
    const format = view.getUint8(record + 14);
    // Sparse ranges list code point offsets, then (format 1) glyph id
    // offsets; without that second list, ids follow the list order.
    const sparse = (withIds: boolean): Map<number, number> =>
      new Map(
        Array.from({ length: entries }, (_, index) => [
          u16(view, data + index * 2),
          withIds ? u16(view, data + (entries + index) * 2) : index,
        ]),
      );
    switch (format) {
      case 0:
        // LVGL reads this list's length as a byte.
        cmaps.push({
          kind: 'full',
          ...range,
          offsets: new Uint8Array(
            view.buffer,
            view.byteOffset + data,
            entries & 0xff,
          ),
        });
        break;
      case 1:
        cmaps.push({ kind: 'sparse', ...range, ids: sparse(true) });
        break;
      case 2:
        cmaps.push({ kind: 'tiny', ...range });
        break;
      case 3:
        cmaps.push({ kind: 'sparse', ...range, ids: sparse(false) });
        break;
      default:
        throw new FontError(`Unknown cmap format ${format}.`);
    }
  }
  return cmaps;
}

function readGlyph(
  bits: BitReader,
  header: {
    readonly defaultAdvance: number;
    readonly advanceFormat: number;
    readonly advanceBits: number;
    readonly xyBits: number;
    readonly whBits: number;
    readonly bpp: number;
  },
): Glyph {
  let advance =
    header.advanceBits === 0
      ? header.defaultAdvance
      : bits.read(header.advanceBits);
  if (header.advanceFormat === 0) {
    advance *= 16;
  }
  const offsetX = bits.readSigned(header.xyBits);
  const offsetY = bits.readSigned(header.xyBits);
  const width = bits.read(header.whBits);
  const height = bits.read(header.whBits);
  const coverage = new Uint8Array(width * height);
  const max = 2 ** header.bpp - 1;
  for (let i = 0; i < coverage.length; i += 1) {
    coverage[i] = Math.round((bits.read(header.bpp) * 255) / max);
  }
  return { advance16: advance, offsetX, offsetY, width, height, coverage };
}

/**
 * Kerning as sorted glyph id pairs (format 0), the only kind the bar's fonts
 * carry; LVGL's class-based format 3 is refused.
 */
function readKerning(view: DataView, start: number, idFormat: number): Kerning {
  const format = view.getUint8(start + 8);
  if (format !== 0) {
    throw new FontError(`Unsupported kerning format ${format}.`);
  }
  const count = u32(view, start + 12);
  const idBytes = idFormat === 0 ? 1 : 2;
  const id = (offset: number): number =>
    idBytes === 1 ? view.getUint8(offset) : u16(view, offset);
  const ids = start + 16;
  const values = ids + count * 2 * idBytes;
  const pairs = new Map<number, number>();
  for (let i = 0; i < count; i += 1) {
    const pair = ids + i * 2 * idBytes;
    pairs.set(pairKey(id(pair), id(pair + idBytes)), view.getInt8(values + i));
  }
  return pairs;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
