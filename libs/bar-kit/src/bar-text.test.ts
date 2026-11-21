import { describe, expect, it } from 'vitest';

import { TEXT_CASES } from './__tests__/contract.ts';
import { toBarText } from './bar-text.ts';

describe('toBarText', () => {
  it('has the shared cases to check', () => {
    expect(TEXT_CASES.length).toBeGreaterThan(0);
  });

  it.each(TEXT_CASES)('turns %j into %j', (text, expected) => {
    expect(toBarText(text)).toBe(expected);
  });
});
