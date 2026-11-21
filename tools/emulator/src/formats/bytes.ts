// Byte helpers the decoders and encoders share. With noUncheckedIndexedAccess
// a typed-array read may be undefined, which none of these reads can be.

/** The byte at `index`, or 0 past the end. */
export function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

/** The character codes of `text`, one byte each, as file tags spell them. */
export function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

/** `parts` one after another, in one new array. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Reads bits most significant first, from bit `from` up to bit `to`; a read
 * past `to` throws the error `overrun` makes. Bits past the end of the
 * bytes read as 0.
 */
export class BitReader {
  readonly #bytes: Uint8Array;
  readonly #to: number;
  readonly #overrun: () => Error;
  #at: number;

  constructor(
    bytes: Uint8Array,
    range: { readonly from: number; readonly to: number },
    overrun: () => Error,
  ) {
    this.#bytes = bytes;
    this.#at = range.from;
    this.#to = range.to;
    this.#overrun = overrun;
  }

  get done(): boolean {
    return this.#at >= this.#to;
  }

  read(count: number): number {
    if (this.#at + count > this.#to) {
      throw this.#overrun();
    }
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = byteAt(this.#bytes, this.#at >> 3);
      value = value * 2 + ((byte >> (7 - (this.#at & 7))) & 1);
      this.#at += 1;
    }
    return value;
  }

  /** `count` bits as a two's complement number. */
  readSigned(count: number): number {
    const value = this.read(count);
    return count > 0 && value >= 2 ** (count - 1) ? value - 2 ** count : value;
  }
}
