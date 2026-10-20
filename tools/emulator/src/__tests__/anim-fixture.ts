// A builder for the bar's own animation files (`.anim`, signature
// "bicycle1", read by lib/anim_file in the firmware), so tests can reach
// every header, mask, and pixel encoding without binary fixtures. Lengths,
// counts, and section offsets follow from the spec unless a test overrides
// them to break the file.

export interface AnimFrameSpec {
  /** The mask encoding, stored in the encoding byte's high nibble. */
  readonly mask: number;
  /** The pixel encoding, stored in the encoding byte's low nibble. */
  readonly pixels: number;
  /** Mask bits as `0` and `1`, most significant first; spaces are ignored. */
  readonly maskBits?: string;
  /** The encoded pixel bytes. */
  readonly data?: readonly number[];
  /** The mask length in bits the frame header claims, if not the real one. */
  readonly maskLength?: number;
  /** The pixel length in bytes the frame header claims, if not the real one. */
  readonly pixelLength?: number;
}

interface AnimSectionSpec {
  readonly name: string;
  readonly start: number;
  /** The last frame, inclusive. */
  readonly end: number;
}

export interface AnimSpec {
  readonly width: number;
  readonly height: number;
  /** 0 BGR888, 1 Gray4, 2 BGRA8888. */
  readonly color: number;
  readonly frames: readonly AnimFrameSpec[];
  readonly fps?: number;
  /** Named sections after the "default" one, which covers every frame. */
  readonly sections?: readonly AnimSectionSpec[];
  /** Every section record, "default" included, for files that break it. */
  readonly sectionRecords?: readonly AnimSectionSpec[];
  /** Bytes to cut off the end of the sections chunk. */
  readonly trimSections?: number;
  readonly signature?: string;
  readonly flags?: number;
  /** The section count the header claims, if not the real one. */
  readonly sectionCount?: number;
  /** The frame count the header claims, if not the real one. */
  readonly frameCount?: number;
}

const HEADER_BYTES = 34;

/** Write a `.anim` file: header, sections chunk, frames chunk. */
export function animFile(spec: AnimSpec): Uint8Array {
  const frameCount = spec.frameCount ?? spec.frames.length;
  const frames = spec.frames.map(encodeFrame);
  const records = spec.sectionRecords ?? [
    { name: 'default', start: 0, end: frameCount - 1 },
    ...(spec.sections ?? []),
  ];
  const sectionsLength =
    records.reduce(
      (sum, record) =>
        sum + 12 + new TextEncoder().encode(record.name).length + 1,
      0,
    ) - (spec.trimSections ?? 0);
  // Each section points at its first frame, as the firmware's converter
  // (scripts/seq2anim.py) writes it.
  const frameOffsets: number[] = [];
  let offset = HEADER_BYTES + sectionsLength;
  for (const frame of frames) {
    frameOffsets.push(offset);
    offset += frame.bytes.length;
  }
  const sections = concat(
    records.map((record) =>
      sectionRecord(record, frameOffsets[record.start] ?? 0),
    ),
  ).subarray(0, sectionsLength);
  const framesChunk = concat(frames.map((frame) => frame.bytes));
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(ascii(spec.signature ?? 'bicycle1'));
  view.setUint8(8, spec.flags ?? 0);
  view.setUint8(9, spec.width);
  view.setUint8(10, spec.height);
  view.setUint8(11, spec.color);
  view.setUint16(
    12,
    Math.max(0, ...frames.map((frame) => frame.maskLength)),
    true,
  );
  view.setUint16(
    14,
    Math.max(0, ...frames.map((frame) => frame.pixelLength)),
    true,
  );
  view.setUint8(16, spec.fps ?? 30);
  view.setUint32(18, sections.length, true);
  view.setUint32(22, framesChunk.length, true);
  view.setUint32(26, spec.sectionCount ?? records.length, true);
  view.setUint32(30, frameCount, true);
  return concat([header, sections, framesChunk]);
}

function encodeFrame(frame: AnimFrameSpec): {
  readonly bytes: Uint8Array;
  readonly maskLength: number;
  readonly pixelLength: number;
} {
  const bits = Array.from((frame.maskBits ?? '').replaceAll(' ', ''));
  const mask = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => {
    if (bit === '1') {
      mask[index >> 3] = (mask[index >> 3] ?? 0) | (0x80 >> (index & 7));
    }
  });
  const data = Uint8Array.from(frame.data ?? []);
  const maskLength = frame.maskLength ?? bits.length;
  const pixelLength = frame.pixelLength ?? data.length;
  const header = new Uint8Array(5);
  const view = new DataView(header.buffer);
  view.setUint8(0, (frame.mask << 4) | frame.pixels);
  view.setUint16(1, maskLength, true);
  view.setUint16(3, pixelLength, true);
  return { bytes: concat([header, mask, data]), maskLength, pixelLength };
}

function sectionRecord(
  record: AnimSectionSpec,
  frameOffset: number,
): Uint8Array {
  const name = new TextEncoder().encode(record.name);
  const out = new Uint8Array(12 + name.length + 1);
  const view = new DataView(out.buffer);
  view.setUint32(0, record.start, true);
  view.setUint32(4, record.end, true);
  view.setUint32(8, frameOffset, true);
  out.set(name, 12);
  return out;
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
