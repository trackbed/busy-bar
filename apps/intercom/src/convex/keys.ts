// The keys bars sign in with. The deployment stores only their hashes, so
// reading its data does not let anyone report as a bar.

import { ConvexError } from 'convex/values';

import type { Doc } from './_generated/dataModel.js';
import type { QueryCtx } from './_generated/server.js';

/** What a function answers when the key it was given names no bar. */
export const UNKNOWN_KEY = 'unknown_key';

const KEY_BYTES = 24;

/** A new random key, as hex. */
export function newKey(): string {
  return hex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return hex(new Uint8Array(digest));
}

/** The bar `key` belongs to; an unknown key is a `ConvexError`. */
export async function requireBar(
  ctx: Pick<QueryCtx, 'db'>,
  key: string,
): Promise<Doc<'bars'>> {
  const keyHash = await hashKey(key);
  const bar = await ctx.db
    .query('bars')
    .withIndex('by_key', (q) => q.eq('keyHash', keyHash))
    .unique();
  if (bar === null) {
    throw new ConvexError(UNKNOWN_KEY);
  }
  return bar;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
