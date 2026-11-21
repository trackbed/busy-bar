import {
  createBusyBar,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { renderClock } from './render-clock.ts';
import { loadSettings } from './settings.ts';

const { timeZone } = loadSettings(process.env);

await runBarApp({
  name: 'clock',
  client: createBusyBar(loadBarConfig()),
  render: (now) => renderClock(now, timeZone),
  intervalMs: 1000,
  signal: shutdownSignal(),
});
