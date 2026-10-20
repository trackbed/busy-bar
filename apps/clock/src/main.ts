import {
  createBusyBar,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { renderClock } from './render-clock.ts';

const timeZone = process.env['CLOCK_TIME_ZONE']?.trim() || undefined;

await runBarApp({
  name: 'clock',
  client: createBusyBar(loadBarConfig()),
  render: (now) => renderClock(now, timeZone),
  intervalMs: 1000,
  signal: shutdownSignal(),
});
