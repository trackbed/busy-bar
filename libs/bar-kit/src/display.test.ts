import { describe, expect, it } from 'vitest';

import { rgba } from './display.ts';

describe('rgba', () => {
  it('formats channels as #RRGGBBAA', () => {
    expect(rgba(255, 140, 0)).toBe('#FF8C00FF');
    expect(rgba(0, 0, 0, 0)).toBe('#00000000');
  });

  it.each([-1, 256, 1.5, Number.NaN])('rejects channel %s', (channel) => {
    expect(() => rgba(channel, 0, 0)).toThrow(RangeError);
  });
});
