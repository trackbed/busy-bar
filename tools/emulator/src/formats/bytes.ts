// Reading bytes the decoders keep in range: with noUncheckedIndexedAccess a
// typed-array read may be undefined, which none of these reads can be.

/** The byte at `index`, or 0 past the end. */
export function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}
