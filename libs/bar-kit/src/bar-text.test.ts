import { describe, expect, it } from 'vitest';

import { toBarText } from './bar-text.ts';

// Written as code points: a formatter would turn escapes into invisible
// characters.
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);
const COMBINING_RING = String.fromCodePoint(0x30a);

describe('toBarText', () => {
  it.each([
    ['Plain ASCII stays as it is', 'Plain ASCII stays as it is'],
    ['Nørreport', 'Noerreport'],
    ['Århus Æblegård', 'Aarhus Aeblegaard'],
    ['ÅRHUS ØSTERBRO', 'AARHUS OESTERBRO'],
    ['Straße', 'Strasse'],
    ['Café crème', 'Cafe creme'],
    ['Łódź', 'Lodz'],
    ['“Quoted” – it’s done…', '"Quoted" - it\'s done...'],
    ['Fix `toBarText`', "Fix 'toBarText'"],
    ['🚀 Launch day 🎉', 'Launch day'],
    ['  tabs\tand\nnewlines  ', 'tabs and newlines'],
    [`non${NO_BREAK_SPACE}breaking`, 'non breaking'],
    ['東京 Tokyo', 'Tokyo'],
    ['', ''],
  ])('turns %j into %j', (text, expected) => {
    expect(toBarText(text)).toBe(expected);
  });

  it('spells out a Danish letter written as a base letter and a ring', () => {
    expect(toBarText(`a${COMBINING_RING}bo`)).toBe('aabo');
  });
});
