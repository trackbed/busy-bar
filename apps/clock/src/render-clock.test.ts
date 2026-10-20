import { describe, expect, it } from 'vitest';

import type { BarElements } from '@busy-bar-apps/bar-kit';

import { renderClock, secondsBarWidth } from './render-clock.ts';

const MORNING = new Date('2026-10-19T09:05:30Z');

function textOf(elements: BarElements, id: string): string | undefined {
  const element = elements.find((candidate) => candidate.id === id);
  return element && 'text' in element ? element.text : undefined;
}

describe('renderClock', () => {
  it('draws the time, the seconds bar, and the date', () => {
    expect(renderClock(MORNING, 'UTC')).toMatchObject([
      { id: 'time', display: 'front', text: '09:05' },
      { id: 'seconds', display: 'front', width: 37, height: 1, y: 15 },
      { id: 'date', display: 'back', text: 'Mon 19 Oct' },
    ]);
  });

  it('shows the time in the requested time zone', () => {
    expect(textOf(renderClock(MORNING, 'Europe/Copenhagen'), 'time')).toBe(
      '11:05',
    );
  });

  it('falls back to the system time zone', () => {
    expect(textOf(renderClock(MORNING), 'time')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('rejects unknown time zones', () => {
    expect(() => renderClock(MORNING, 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('secondsBarWidth', () => {
  it('starts with one pixel and fills the display in the last second', () => {
    expect(secondsBarWidth(0)).toBe(1);
    expect(secondsBarWidth(29)).toBe(36);
    expect(secondsBarWidth(59)).toBe(72);
  });
});
