// The run-length encoding the bar uses for screen frames on its status
// stream (lib/toolbox/rle_encode.c in the firmware): an opcode byte, then
// either `op & 0x7f` literal blocks (high bit set) or one block repeated
// `op` times.

const MAX_COUNT = 0x7f;

/** Encode `data` in blocks of `blockSize` bytes (3 for an RGB888 frame). */
export function encodeRle(data: Uint8Array, blockSize: number): Uint8Array {
  const blocks = Math.floor(data.length / blockSize);
  const out: number[] = [];
  const block = (index: number): Uint8Array =>
    data.subarray(index * blockSize, (index + 1) * blockSize);
  const same = (a: number, b: number): boolean => {
    for (let i = 0; i < blockSize; i += 1) {
      if (data[a * blockSize + i] !== data[b * blockSize + i]) {
        return false;
      }
    }
    return true;
  };
  let index = 0;
  while (index < blocks) {
    let run = 1;
    while (
      index + run < blocks &&
      run < MAX_COUNT &&
      same(index, index + run)
    ) {
      run += 1;
    }
    if (run > 1) {
      out.push(run, ...block(index));
      index += run;
      continue;
    }
    let literals = 1;
    while (
      index + literals < blocks &&
      literals < MAX_COUNT &&
      !(
        index + literals + 1 < blocks &&
        same(index + literals, index + literals + 1)
      )
    ) {
      literals += 1;
    }
    out.push(0x80 | literals);
    for (let i = 0; i < literals; i += 1) {
      out.push(...block(index + i));
    }
    index += literals;
  }
  return Uint8Array.from(out);
}

/** Decode what `encodeRle` writes; the inverse, for tests and tools. */
export function decodeRle(data: Uint8Array, blockSize: number): Uint8Array {
  const out: number[] = [];
  let at = 0;
  while (at < data.length) {
    const op = data[at] ?? 0;
    at += 1;
    if ((op & 0x80) !== 0) {
      const length = (op & MAX_COUNT) * blockSize;
      out.push(...data.subarray(at, at + length));
      at += length;
    } else {
      const repeated = data.subarray(at, at + blockSize);
      for (let i = 0; i < op; i += 1) {
        out.push(...repeated);
      }
      at += blockSize;
    }
  }
  return Uint8Array.from(out);
}
