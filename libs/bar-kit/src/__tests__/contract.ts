// The cases of bar-kit-contract.json, which the Python kit's tests read too,
// so the two kits cannot drift apart on them.

import { readFileSync } from 'node:fs';

import { arrayAt, isObject, stringAt } from '@busy-bar-apps/json-values';

const contract: unknown = JSON.parse(
  readFileSync(
    new URL('../../../../bar-kit-contract.json', import.meta.url),
    'utf8',
  ),
);
if (!isObject(contract)) {
  throw new TypeError('bar-kit-contract.json has an unexpected shape.');
}

function malformed(entry: unknown): never {
  throw new TypeError(
    `bar-kit-contract.json has a malformed entry ${JSON.stringify(entry)}.`,
  );
}

/** Text and what `toBarText` turns it into. */
export const TEXT_CASES = arrayAt(contract, 'toBarText').map((entry) => {
  const text = isObject(entry) ? stringAt(entry, 'text') : undefined;
  const expected = isObject(entry) ? stringAt(entry, 'expected') : undefined;
  return text === undefined || expected === undefined
    ? malformed(entry)
    : ([text, expected] as const);
});

/** Text `textWidth` refuses: the fonts draw printable ASCII only. */
export const UNMEASURABLE = arrayAt(contract, 'unmeasurable').map((entry) =>
  typeof entry === 'string' ? entry : malformed(entry),
);

/**
 * `BUSYBAR_ADDR` values and whether each is the BUSY cloud, or `undefined`
 * for one `loadBarConfig` refuses.
 */
export const ADDRESSES = arrayAt(contract, 'addresses').map((entry) => {
  const addr = isObject(entry) ? stringAt(entry, 'addr') : undefined;
  const cloud = isObject(entry) ? entry['cloud'] : undefined;
  if (addr === undefined || !(typeof cloud === 'boolean' || cloud === null)) {
    return malformed(entry);
  }
  return [addr, cloud ?? undefined] as const;
});
