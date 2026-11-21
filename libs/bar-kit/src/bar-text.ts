// Letters and punctuation that Unicode normalization cannot reduce to ASCII,
// and the backtick, which most of the bar's fonts lack. Danish letters follow
// the Danish convention, so `Århus` becomes `Aarhus`.
const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['`', "'"],
  ['æ', 'ae'],
  ['Æ', 'AE'],
  ['ø', 'oe'],
  ['Ø', 'OE'],
  ['å', 'aa'],
  ['Å', 'AA'],
  ['ß', 'ss'],
  ['œ', 'oe'],
  ['Œ', 'OE'],
  ['đ', 'd'],
  ['Đ', 'D'],
  ['ł', 'l'],
  ['Ł', 'L'],
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['«', '"'],
  ['»', '"'],
  ['‐', '-'],
  ['–', '-'],
  ['—', '-'],
  ['−', '-'],
  ['…', '...'],
  ['•', '*'],
]);

// Unicode's White_Space property, spelled out so both kits match the same
// characters: each language's `\s` differs from it, and from the other's.
const WHITESPACE =
  /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

/**
 * Turn any text into what the bar's bitmap fonts can draw: printable ASCII
 * without the backtick.
 * Known letters and punctuation are spelled out, accents are dropped, runs of
 * whitespace become one space, and anything else (emoji, CJK, control and
 * format characters) disappears. Both kits test their results against
 * `bar-kit-contract.json`, so the Python kit's `to_bar_text` gives the same.
 */
export function toBarText(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  const spelled = chars
    .map((char, index) => spell(char, chars[index + 1]))
    .join('');
  return spelled
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(WHITESPACE, ' ')
    .replaceAll(/[^\x20-\x7E]/gu, '')
    .replaceAll(/ {2,}/gu, ' ')
    .trim();
}

// A capital spelled with two letters keeps the case of the word around it:
// `Århus` becomes `Aarhus`, and `ÅRHUS` becomes `AARHUS`.
function spell(char: string, next: string | undefined): string {
  const replacement = REPLACEMENTS.get(char);
  if (replacement === undefined) {
    return char;
  }
  const inLowercaseWord =
    next !== undefined &&
    next !== next.toUpperCase() &&
    char !== char.toLowerCase();
  return inLowercaseWord
    ? replacement.charAt(0) + replacement.slice(1).toLowerCase()
    : replacement;
}
