import type { BarElements } from '@busy-bar-apps/bar-kit';
import { BACK_DISPLAY, FRONT_DISPLAY, rgba } from '@busy-bar-apps/bar-kit';

const TIME_COLOR = rgba(255, 255, 255);
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
    {
      id: 'time',
      type: 'text',
      display: 'front',
      text: time,
      font: 'extra_large',
      color: TIME_COLOR,
      align: 'top_mid',
      x: FRONT_DISPLAY.width / 2,
      y: 1,
    },
    {
      id: 'seconds',
      type: 'rectangle',
      display: 'front',
      x: 0,
      y: FRONT_DISPLAY.height - 1,
      width: secondsBarWidth(second),
      height: 1,
      fill: 'solid',
      fill_colors: [SECONDS_COLOR],
      border_width: 0,
    },
    {
      id: 'date',
      type: 'text',
      display: 'back',
      text: date,
      font: 'large',
      align: 'center',
      x: BACK_DISPLAY.width / 2,
      y: BACK_DISPLAY.height / 2,
    },
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
