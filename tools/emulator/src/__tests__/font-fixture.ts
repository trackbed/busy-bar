// A builder for fonts in LVGL's binary format, so tests can reach every
// table variant without the firmware's font files.

import { ascii, concat } from '../formats/bytes.ts';

export interface GlyphSpec {
  readonly codePoint: number;
  /** Rows of `#` (ink) and `.` (none); the rows set the box size. */
  readonly rows: readonly string[];
  /** In whole pixels, or 1/16 pixel when the font's advance format is 1. */
  readonly advance: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface FontSpec {
  readonly ascent: number;
  /** Zero or negative. */
  readonly descent: number;
  readonly glyphs: readonly GlyphSpec[];
  /** How the one cmap range is stored: 0 full, 1 sparse full, 2 tiny, 3 sparse tiny. */
  readonly cmapFormat?: number;
  /** Pairs of code points and a kerning value in 1/16 pixel before scaling. */
  readonly kerning?: readonly {
    readonly left: number;
    readonly right: number;
    readonly value: number;
  }[];
  readonly kerningFormat?: number;
  readonly kernScale?: number;
  readonly advanceFormat?: 0 | 1;
  readonly locFormat?: 0 | 1;
  readonly idFormat?: 0 | 1;
  readonly bpp?: number;
  readonly compression?: number;
}

const XY_BITS = 5;
const WH_BITS = 5;
const ADVANCE_BITS = 10;

/** Write a `.font` file. Glyph ids follow code point order, from 1. */
export function binFont(spec: FontSpec): Uint8Array {
  const glyphs = [...spec.glyphs].sort((a, b) => a.codePoint - b.codePoint);
  const bpp = spec.bpp ?? 1;
  const head = new Uint8Array(48);
  const headView = new DataView(head.buffer);
  headView.setUint32(0, 48, true);
  head.set(ascii('head'), 4);
  headView.setUint32(8, 1, true);
  headView.setUint16(12, spec.kerning === undefined ? 3 : 4, true);
  headView.setUint16(14, spec.ascent - spec.descent, true);
  headView.setUint16(16, spec.ascent, true);
  headView.setInt16(18, spec.descent, true);
  headView.setUint16(32, spec.kernScale ?? 16, true);
  head.set(
    [
      spec.locFormat ?? 0,
      spec.idFormat ?? 0,
      spec.advanceFormat ?? 0,
      bpp,
      XY_BITS,
      WH_BITS,
      ADVANCE_BITS,
      spec.compression ?? 0,
    ],
    34,
  );
  const tables = [head, cmap(glyphs, spec.cmapFormat ?? 3)];
  const glyphData: Uint8Array[] = [
    new Uint8Array(Math.ceil((ADVANCE_BITS + 2 * XY_BITS + 2 * WH_BITS) / 8)),
  ];
  for (const glyph of glyphs) {
    glyphData.push(encodeGlyph(glyph, bpp));
  }
  const offsets: number[] = [];
  let offset = 8;
  for (const data of glyphData) {
    offsets.push(offset);
    offset += data.length;
  }
  const wide = (spec.locFormat ?? 0) === 1;
  const loca = new Uint8Array(4 + offsets.length * (wide ? 4 : 2));
  const locaView = new DataView(loca.buffer);
  locaView.setUint32(0, offsets.length, true);
  offsets.forEach((value, index) => {
    if (wide) {
      locaView.setUint32(4 + index * 4, value, true);
    } else {
      locaView.setUint16(4 + index * 2, value, true);
    }
  });
  tables.push(table('loca', loca), table('glyf', concat(glyphData)));
  if (spec.kerning !== undefined) {
    tables.push(
      kern(glyphs, spec.kerning, spec.idFormat ?? 0, spec.kerningFormat ?? 0),
    );
  }
  return concat(tables);
}

/**
 * A plain test font: every printable ASCII character but the backtick is a
 * solid 3x5 box advancing 4 pixels, the space has no box, and lines are
 * 6 pixels tall with the baseline 1 pixel up.
 */
export function boxFont(): Uint8Array {
  const glyphs: GlyphSpec[] = [];
  for (let codePoint = 0x20; codePoint < 0x7f; codePoint += 1) {
    if (codePoint !== 0x60) {
      glyphs.push({
        codePoint,
        rows: codePoint === 0x20 ? [] : ['###', '###', '###', '###', '###'],
        advance: 4,
      });
    }
  }
  return binFont({ ascent: 5, descent: -1, glyphs });
}

function cmap(glyphs: readonly GlyphSpec[], format: number): Uint8Array {
  const first = glyphs[0]?.codePoint ?? 0;
  const last = glyphs.at(-1)?.codePoint ?? 0;
  const deltas = glyphs.map((glyph) => glyph.codePoint - first);
  let data: number[];
  let entries = glyphs.length;
  switch (format) {
    case 0: {
      // One byte per code point in the range: the glyph id offset, 0 when missing.
      entries = last - first + 1;
      data = Array.from({ length: entries }, (_, relative) =>
        Math.max(0, deltas.indexOf(relative)),
      );
      break;
    }
    case 1:
      data = [
        ...deltas.flatMap(u16),
        ...deltas.map((_, index) => index).flatMap(u16),
      ];
      break;
    case 2:
      data = [];
      break;
    default:
      data = deltas.flatMap(u16);
  }
  const body = new Uint8Array(4 + 16 + data.length);
  const view = new DataView(body.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 8 + 4 + 16, true);
  view.setUint32(8, first, true);
  view.setUint16(12, last - first + 1, true);
  view.setUint16(14, 1, true);
  view.setUint16(16, entries, true);
  view.setUint8(18, format);
  body.set(data, 20);
  return table('cmap', body);
}

function encodeGlyph(glyph: GlyphSpec, bpp: number): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, count: number): void => {
    for (let i = count - 1; i >= 0; i -= 1) {
      bits.push((value >> i) & 1);
    }
  };
  const width = glyph.rows[0]?.length ?? 0;
  push(glyph.advance, ADVANCE_BITS);
  push((glyph.offsetX ?? 0) & ((1 << XY_BITS) - 1), XY_BITS);
  push((glyph.offsetY ?? 0) & ((1 << XY_BITS) - 1), XY_BITS);
  push(width, WH_BITS);
  push(glyph.rows.length, WH_BITS);
  for (const row of glyph.rows) {
    for (const cell of row) {
      push(cell === '#' ? (1 << bpp) - 1 : 0, bpp);
    }
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => {
    bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (bit << (7 - (index & 7)));
  });
  return bytes;
}

function kern(
  glyphs: readonly GlyphSpec[],
  pairs: readonly {
    readonly left: number;
    readonly right: number;
    readonly value: number;
  }[],
  idFormat: number,
  format: number,
): Uint8Array {
  const id = (codePoint: number): number =>
    glyphs.findIndex((glyph) => glyph.codePoint === codePoint) + 1;
  const ids = pairs.flatMap((pair) =>
    idFormat === 0
      ? [id(pair.left), id(pair.right)]
      : [...u16(id(pair.left)), ...u16(id(pair.right))],
  );
  const body = new Uint8Array(8 + ids.length + pairs.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, format);
  view.setUint32(4, pairs.length, true);
  body.set(ids, 8);
  pairs.forEach((pair, index) => {
    view.setInt8(8 + ids.length + index, pair.value);
  });
  return table('kern', body);
}

/** A table: its padded length, its tag, then its body. */
function table(tag: string, body: Uint8Array): Uint8Array {
  const length = Math.ceil((8 + body.length) / 4) * 4;
  const out = new Uint8Array(length);
  new DataView(out.buffer).setUint32(0, length, true);
  out.set(ascii(tag), 4);
  out.set(body, 8);
  return out;
}

function u16(value: number): number[] {
  return [value & 0xff, value >> 8];
}
