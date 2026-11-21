import type { RectangleElement, TextElement } from '@busy-app/busy-lib';

import { BACK_DISPLAY, FRONT_DISPLAY, rgba } from './display.ts';
import type { BarFont } from './fonts.ts';

/** The display an element is drawn on. */
export type BarDisplay = 'front' | 'back';

/** Which point of a text element `x` and `y` place. */
export type TextAlign = NonNullable<TextElement['align']>;

/**
 * One colour per role, shared by every app so the same role looks the same
 * on every bar. The back display shows 16 levels of grey (a channel's top
 * four bits), so the greys sit on distinct levels: `bright` 15, `text` 12,
 * `dim` 7, and `idle` 6.
 */
export const PALETTE = {
  /** Highlighted text: the selected row, a title. White, the bar's default. */
  bright: rgba(255, 255, 255),
  /** Body text. */
  text: rgba(200, 200, 200),
  /** Secondary text: headers, footers, hints. */
  dim: rgba(120, 120, 120),
  /** Nothing to report: no data yet, nothing open, a source unavailable. */
  idle: rgba(110, 110, 110),
  /** All is well: free, live, passing, plenty. */
  good: rgba(0, 200, 90),
  /** Needs attention soon: pending, low, paused, a knock. */
  warn: rgba(255, 170, 0),
  /** Needs you now: failing, empty, busy, at the limit. */
  bad: rgba(255, 60, 60),
  /** Neutral news: queued, resting, rain, a focus session. */
  info: rgba(60, 130, 255),
} as const;

/**
 * The front display's summary line: `tiny` text (rows 9-14) under a `small`
 * headline at y 0.
 */
export const SUMMARY_Y = 9;

/** The back display's footer line: `tiny` text on its last seven rows. */
export const FOOTER_Y = BACK_DISPLAY.height - 7;

/** What {@link textElement} needs; `color` defaults to `PALETTE.text`. */
export interface TextElementOptions {
  readonly id: string;
  readonly text: string;
  readonly display: BarDisplay;
  readonly font: BarFont;
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  /** Leave it out for `top_left`, the bar's default. */
  readonly align?: TextAlign;
}

/** A text element, placed by name so `x` and `y` cannot swap. */
export function textElement({
  id,
  text,
  display,
  font,
  x,
  y,
  color = PALETTE.text,
  align,
}: TextElementOptions): TextElement {
  return {
    id,
    type: 'text',
    display,
    text,
    font,
    color,
    x,
    y,
    ...(align === undefined ? {} : { align }),
  };
}

/** What {@link solidRectangle} needs. */
export interface SolidRectangleOptions {
  readonly id: string;
  readonly display: BarDisplay;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

/** A rectangle filled with one colour, without a border. */
export function solidRectangle({
  id,
  display,
  x,
  y,
  width,
  height,
  color,
}: SolidRectangleOptions): RectangleElement {
  return {
    id,
    type: 'rectangle',
    display,
    x,
    y,
    width,
    height,
    fill: 'solid',
    fill_colors: [color],
    border_width: 0,
  };
}

/** How {@link statusCells} spaces its cells. */
export interface StatusCellsOptions {
  /** Columns from one cell's left edge to the next. */
  readonly pitch: number;
  /** Columns each cell fills. */
  readonly width: number;
}

/**
 * One cell per colour along the front display's bottom row, from the left,
 * with IDs `cell-0`, `cell-1`, and so on. Pass only the colours that fit:
 * `FRONT_DISPLAY.width / pitch` of them.
 */
export function statusCells(
  colors: readonly string[],
  { pitch, width }: StatusCellsOptions,
): RectangleElement[] {
  return colors.map((color, index) =>
    solidRectangle({
      id: `cell-${index}`,
      display: 'front',
      x: index * pitch,
      y: FRONT_DISPLAY.height - 1,
      width,
      height: 1,
      color,
    }),
  );
}
