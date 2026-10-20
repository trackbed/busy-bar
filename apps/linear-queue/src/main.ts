import {
  createBusyBar,
  createPoller,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchQueue } from './linear.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';

const NAME = 'linear-queue';
const REFRESH_MS = 3 * 60_000;

const settings = loadSettings(process.env);
const signal = shutdownSignal();

const poller = createPoller({
  name: NAME,
  intervalMs: REFRESH_MS,
  retryMs: 60_000,
  fetch: (fetchSignal) =>
    fetchQueue({
      apiKey: settings.apiKey,
      scope: settings.scope,
      signal: fetchSignal,
    }),
});

await Promise.all([
  poller.run(signal),
  runBarApp({
    name: NAME,
    client: createBusyBar(loadBarConfig()),
    render: (now) =>
      render(now, poller.latest(), poller.failure(), {
        scope: settings.scope,
        low: settings.low,
      }),
    intervalMs: 1000,
    signal,
  }),
]);
