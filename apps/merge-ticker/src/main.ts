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
import type { TickerState } from './watch.ts';
import { createTickerFetch } from './watch.ts';

const NAME = 'merge-ticker';
const REFRESH_MS = 60_000;

const settings = loadSettings(process.env);
const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();

const poller = createPoller<TickerState>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: createTickerFetch({
    name: NAME,
    pullRequests: (now, fetchSignal) =>
      fetchPullRequests({
        token: settings.token,
        scope: settings.scope,
        startOfDay: startOfDay(now, settings.timeZone),
        signal: fetchSignal,
      }),
    play: settings.sound
      ? (stockPath) =>
          bar.AudioPlay({ application_name: NAME, stock_path: stockPath })
      : undefined,
  }),
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
