import type { Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import { renderClock } from './render-clock.ts';

const TIME_ZONE = 'Europe/Copenhagen';

/** Sample frames for the app catalogue: `nx run clock:preview`. */
export function preview(): Preview {
  return {
    summary: 'The time on the front display and the date on the back.',
    steps: [
      {
        label: 'Reads',
        text: 'The system clock once a second, in CLOCK_TIME_ZONE or the system zone.',
      },
      {
        label: 'Draws',
        text: 'HH:MM in the largest font over a 1 px bar that fills across each minute, and the date behind.',
      },
    ],
    scenes: [
      {
        title: 'Mid-minute',
        caption:
          '20 seconds into 09:41: the bar along the bottom is a third full.',
        elements: renderClock(new Date('2026-10-21T07:41:20Z'), TIME_ZONE),
      },
      {
        title: 'Last second',
        caption:
          'At 23:59:59 the bar spans the whole display, then starts over.',
        elements: renderClock(new Date('2026-10-21T21:59:59Z'), TIME_ZONE),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
