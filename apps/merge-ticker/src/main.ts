import {
  createBusyBar,
  createPoller,
  createSpeaker,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchPullRequests, startOfDay } from './github.ts';
import { readIncoming } from './incoming.ts';
import { renderIncoming } from './render-incoming.ts';
import { render } from './render.ts';
import { loadIncomingPath, loadSettings } from './settings.ts';
import type { TickerState } from './watch.ts';
import { createTickerFetch } from './watch.ts';

const NAME = 'merge-ticker';
const REFRESH_MS = 60_000;

const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();
const incoming = loadIncomingPath(process.env);
if (incoming) {
  const poller = createPoller({
    name: NAME,
    intervalMs: 5_000,
    fetch: () => readIncoming(incoming),
  });
  await Promise.all([
    poller.run(signal),
    runBarApp({
      name: NAME,
      client: bar,
      render: (now) =>
        renderIncoming(
          now,
          poller.latest()?.value,
          poller.failure() !== undefined,
        ),
      intervalMs: 1000,
      signal,
    }),
  ]);
} else {
  const settings = loadSettings(process.env);
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
}
