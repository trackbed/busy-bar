import { describe, expect, it } from 'vitest';

import { formatAge, freshnessLine } from './freshness.ts';

const NOW = new Date('2026-10-20T12:00:00Z');
const MINUTE = 60_000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('formatAge', () => {
  it('rounds down to minutes, then hours', () => {
    expect(
      [0, 59, 60, 3599, 3600, 7199, 2 * 86_400].map((seconds) =>
        formatAge(NOW, ago(seconds * 1000)),
      ),
    ).toStrictEqual(['now', 'now', '1m', '59m', '1h', '1h', '48h']);
  });

  it('reads a time after now as now', () => {
    expect(formatAge(NOW, new Date(NOW.getTime() + MINUTE))).toBe('now');
  });
});

describe('freshnessLine', () => {
  const failure = { error: new Error('offline'), at: NOW };

  it('says how old the data is', () => {
    expect(
      freshnessLine('Linear', { value: 1, at: ago(0) }, undefined, NOW, MINUTE),
    ).toBe('updated just now');
    expect(
      freshnessLine(
        'Linear',
        { value: 1, at: ago(120 * MINUTE) },
        undefined,
        NOW,
        MINUTE,
      ),
    ).toBe('updated 2h ago');
  });

  it('keeps the usual line through a short failure', () => {
    expect(
      freshnessLine(
        'Linear',
        { value: 1, at: ago(5 * MINUTE) },
        failure,
        NOW,
        5 * MINUTE,
      ),
    ).toBe('updated 5m ago');
  });

  it('names the source once its data is stale', () => {
    expect(
      freshnessLine(
        'Linear',
        { value: 1, at: ago(5 * MINUTE + 1) },
        failure,
        NOW,
        5 * MINUTE,
      ),
    ).toBe('Linear unreachable, showing old data');
  });
});
