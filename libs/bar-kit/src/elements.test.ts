import { describe, expect, it } from 'vitest';

import { FRONT_DISPLAY } from './display.ts';
import {
  colorOf,
  elementsById,
  FOOTER_Y,
  PALETTE,
  solidRectangle,
  statusCells,
  SUMMARY_Y,
  textElement,
  textOf,
} from './elements.ts';

describe('PALETTE', () => {
  it('gives each role the colour the Python kit gives it', () => {
    expect(PALETTE).toEqual({
      bright: '#FFFFFFFF',
      text: '#C8C8C8FF',
      dim: '#787878FF',
      idle: '#6E6E6EFF',
      good: '#00C85AFF',
      warn: '#FFAA00FF',
      bad: '#FF3C3CFF',
      info: '#3C82FFFF',
    });
  });
});

describe('line positions', () => {
  it('puts the summary under the headline and the footer on the last rows', () => {
    expect(SUMMARY_Y).toBe(9);
    expect(FOOTER_Y).toBe(73);
  });
});

describe('textElement', () => {
  it('draws body text at the bar default alignment', () => {
    expect(
      textElement({
        id: 'title',
        text: 'HI',
        display: 'back',
        font: 'small',
        x: 3,
        y: 4,
      }),
    ).toStrictEqual({
      id: 'title',
      type: 'text',
      display: 'back',
      text: 'HI',
      font: 'small',
      color: PALETTE.text,
      x: 3,
      y: 4,
    });
  });

  it('takes a colour and an alignment', () => {
    expect(
      textElement({
        id: 'age',
        text: '5m',
        display: 'front',
        font: 'tiny',
        x: FRONT_DISPLAY.width - 1,
        y: SUMMARY_Y,
        color: PALETTE.warn,
        align: 'top_right',
      }),
    ).toMatchObject({ color: PALETTE.warn, align: 'top_right', x: 71, y: 9 });
  });
});

describe('solidRectangle', () => {
  it('fills one colour without a border', () => {
    expect(
      solidRectangle({
        id: 'bar',
        display: 'front',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        color: PALETTE.good,
      }),
    ).toStrictEqual({
      id: 'bar',
      type: 'rectangle',
      display: 'front',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      fill: 'solid',
      fill_colors: [PALETTE.good],
      border_width: 0,
    });
  });
});

describe('statusCells', () => {
  it('draws one cell per colour along the front bottom row', () => {
    expect(
      statusCells([PALETTE.good, PALETTE.bad], { pitch: 4, width: 3 }),
    ).toStrictEqual([
      solidRectangle({
        id: 'cell-0',
        display: 'front',
        x: 0,
        y: 15,
        width: 3,
        height: 1,
        color: PALETTE.good,
      }),
      solidRectangle({
        id: 'cell-1',
        display: 'front',
        x: 4,
        y: 15,
        width: 3,
        height: 1,
        color: PALETTE.bad,
      }),
    ]);
  });
});

describe('render-test lookups', () => {
  const elements = elementsById([
    textElement({
      id: 'headline',
      text: 'HI',
      display: 'front',
      font: 'small',
      x: 0,
      y: 0,
      color: PALETTE.good,
    }),
    ...statusCells([PALETTE.bad], { pitch: 4, width: 3 }),
  ]);

  it('keys elements by ID', () => {
    expect([...elements.keys()]).toEqual(['headline', 'cell-0']);
  });

  it('reads a text element', () => {
    expect(textOf(elements, 'headline')).toBe('HI');
    expect(colorOf(elements, 'headline')).toBe(PALETTE.good);
  });

  it('gives undefined for a missing or non-text element', () => {
    expect(textOf(elements, 'cell-0')).toBeUndefined();
    expect(colorOf(elements, 'cell-0')).toBeUndefined();
    expect(textOf(elements, 'missing')).toBeUndefined();
    expect(colorOf(elements, 'missing')).toBeUndefined();
  });
});
