import {
  createBusyBar,
  createPoller,
  createSpeaker,
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
const speaker = createSpeaker({
  name: NAME,
  client: bar,
  enabled: settings.sound,
  signal,
});

const poller = createPoller<TickerState>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: createTickerFetch({
    pullRequests: (now, fetchSignal) =>
      fetchPullRequests({
        token: settings.token,
        scope: settings.scope,
        startOfDay: startOfDay(now, settings.timeZone),
        signal: fetchSignal,
      }),
    play: speaker.play,
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
