import {
  createBusyBar,
  createPoller,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchPullRequests, startOfDay } from './github.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';
import type { Alert, TickerState } from './watch.ts';
import { MergeWatch } from './watch.ts';

const NAME = 'merge-ticker';
const REFRESH_MS = 60_000;

// Built-in sounds every bar ships.
const SOUNDS: Readonly<Record<Alert, string>> = {
  merged: 'shared/sounds/calendar_event_starts.snd',
  failing: 'shared/sounds/calendar_reminder_ends.snd',
};

const settings = loadSettings(process.env);
const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();
const watch = new MergeWatch();

const poller = createPoller<TickerState>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: async (fetchSignal) => {
    const now = new Date();
    const pulls = await fetchPullRequests({
      token: settings.token,
      scope: settings.scope,
      startOfDay: startOfDay(now, settings.timeZone),
      signal: fetchSignal,
    });
    const { state, alert } = watch.observe(pulls, now);
    if (alert !== undefined && settings.sound) {
      try {
        await bar.AudioPlay({
          application_name: NAME,
          stock_path: SOUNDS[alert],
        });
      } catch (error) {
        console.warn(`[${NAME}] Playing a sound failed:`, error);
      }
    }
    return state;
  },
});

await Promise.all([
  poller.run(signal),
  runBarApp({
    name: NAME,
    client: bar,
    render: (now) => render(now, poller.latest(), poller.failure()),
    intervalMs: 1000,
    signal,
  }),
]);
