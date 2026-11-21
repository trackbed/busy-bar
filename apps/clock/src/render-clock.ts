import type { BarElements } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  PALETTE,
  rgba,
  solidRectangle,
  textElement,
} from '@busy-bar-apps/bar-kit';

const SECONDS_COLOR = rgba(255, 140, 0);

interface ClockParts {
  readonly time: string;
  readonly second: number;
  readonly date: string;
}

/**
 * Draw `HH:MM` on the front display above a bar that fills over each minute,
 * and the date on the back display. `timeZone` is an IANA name such as
 * `Europe/Copenhagen`; it defaults to the system time zone.
 */
export function renderClock(now: Date, timeZone?: string): BarElements {
  const { time, second, date } = clockParts(now, timeZone);
  return [
    textElement({
      id: 'time',
      text: time,
      display: 'front',
      font: 'extra_large',
      x: FRONT_DISPLAY.width / 2,
      y: 1,
      color: PALETTE.bright,
      align: 'top_mid',
    }),
    solidRectangle({
      id: 'seconds',
      display: 'front',
      x: 0,
      y: FRONT_DISPLAY.height - 1,
      width: secondsBarWidth(second),
      height: 1,
      color: SECONDS_COLOR,
    }),
    textElement({
      id: 'date',
      text: date,
      display: 'back',
      font: 'large',
      x: BACK_DISPLAY.width / 2,
      y: BACK_DISPLAY.height / 2,
      color: PALETTE.bright,
      align: 'center',
    }),
  ];
}

/**
 * Width of the seconds bar: it grows every second and spans the whole display
 * in the last second of the minute.
 */
export function secondsBarWidth(second: number): number {
  return Math.round(((second + 1) / 60) * FRONT_DISPLAY.width);
}

function clockParts(now: Date, timeZone: string | undefined): ClockParts {
  // en-GB gives `09:05` and `Mon 19 Oct`: printable ASCII, which is all the
  // bar's bitmap fonts can draw.
  const format = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-GB', {
      ...options,
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(now);

  return {
    time: format({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    second: Number(format({ second: 'numeric' })),
    date: format({ weekday: 'short', day: 'numeric', month: 'short' }),
  };
}
