// Builders for test files: PNGs and ZIPs written byte by byte, so tests can
// reach every format variant without binary fixtures.

import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

import { ascii, concat } from '../formats/bytes.ts';

export interface PngParts {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced?: boolean;
  /** Scanlines with their filter byte, already filtered. */
  readonly data: Uint8Array;
  readonly palette?: number[];
  readonly transparency?: number[];
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Build a PNG file by hand, so tests can reach every colour type. */
export function png(parts: PngParts): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, parts.width);
  view.setUint32(4, parts.height);
  header.set(
    [parts.bitDepth, parts.colorType, 0, 0, parts.interlaced ? 1 : 0],
    8,
  );
  return concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...(parts.palette ? [chunk('PLTE', Uint8Array.from(parts.palette))] : []),
    ...(parts.transparency
      ? [chunk('tRNS', Uint8Array.from(parts.transparency))]
      : []),
    chunk('IDAT', deflateSync(parts.data)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface FileSpec {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method?: number;
  readonly flags?: number;
  readonly sizeOverride?: number;
}

/** Write a ZIP archive by hand: local headers, central directory, end record. */
export function zip(files: readonly FileSpec[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(file.data) : file.data;
    const name = new TextEncoder().encode(file.name);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, method, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(8, file.flags ?? 0, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(20, body.length, true);
    entryView.setUint32(24, file.sizeOverride ?? file.data.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, body);
    directory.push(entry);
    offset += local.length + body.length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return concat([...parts, ...directory, end]);
}

/** A solid 8-bit RGBA PNG of one colour. */
export function solidPng(
  width: number,
  height: number,
  rgba: readonly number[],
): Uint8Array {
  const row = [0, ...Array.from({ length: width }, () => rgba).flat()];
  const data = Uint8Array.from(
    Array.from({ length: height }, () => row).flat(),
  );
  return png({ width, height, bitDepth: 8, colorType: 6, data });
}
