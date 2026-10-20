// Reading ZIP archives with Node's zlib: the firmware ships its stock
// animations as ZIPs of PNG frames.

import { inflateRawSync } from 'node:zlib';

/** One file in an archive. */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** The bytes are not a ZIP this reader can open. */
export class ZipError extends Error {
  override readonly name = 'ZipError';
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_OF_DIRECTORY_SIZE = 22;
const MAX_COMMENT = 0xffff;

/**
 * Every file in a ZIP archive, in directory order. Folders and the
 * `__MACOSX` metadata macOS adds are left out. Stored and deflated entries
 * are supported; ZIP64 and encryption are not.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== DIRECTORY_ENTRY
    ) {
      throw new ZipError('The ZIP directory is corrupt.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeader = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/') || name.startsWith('__MACOSX/')) {
      continue;
    }
    if ((flags & 1) !== 0) {
      throw new ZipError(`${name} is encrypted.`);
    }
    const data = readData(bytes, view, localHeader, compressedSize, name);
    entries.push({ name, data: decompress(data, method, size, name) });
  }
  return entries;
}

function findEndOfDirectory(view: DataView): number {
  const lowest = Math.max(
    0,
    view.byteLength - END_OF_DIRECTORY_SIZE - MAX_COMMENT,
  );
  for (
    let at = view.byteLength - END_OF_DIRECTORY_SIZE;
    at >= lowest;
    at -= 1
  ) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      return at;
    }
  }
  throw new ZipError('Not a ZIP archive.');
}

function readData(
  bytes: Uint8Array,
  view: DataView,
  localHeader: number,
  compressedSize: number,
  name: string,
): Uint8Array {
  if (
    localHeader + 30 > bytes.length ||
    view.getUint32(localHeader, true) !== LOCAL_HEADER
  ) {
    throw new ZipError(`${name} has no local header.`);
  }
  const start =
    localHeader +
    30 +
    view.getUint16(localHeader + 26, true) +
    view.getUint16(localHeader + 28, true);
  if (start + compressedSize > bytes.length) {
    throw new ZipError(`${name} is truncated.`);
  }
  return bytes.subarray(start, start + compressedSize);
}

function decompress(
  data: Uint8Array,
  method: number,
  size: number,
  name: string,
): Uint8Array {
  if (method === 0) {
    return data;
  }
  if (method !== 8) {
    throw new ZipError(
      `${name} uses compression method ${method}; only stored and deflated files are supported.`,
    );
  }
  try {
    const out = inflateRawSync(data);
    if (out.length !== size) {
      throw new ZipError(
        `${name} inflated to ${out.length} bytes instead of ${size}.`,
      );
    }
    return out;
  } catch (error) {
    if (error instanceof ZipError) {
      throw error;
    }
    throw new ZipError(`${name} is corrupt.`, { cause: error });
  }
}
