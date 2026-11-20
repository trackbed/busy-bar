import {
  createBusyBar,
  createPoller,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchChallenge } from './challenge.ts';
import type { EventSnapshot } from './event.ts';
import { createEventFetch } from './event.ts';
import { PhotoCraft } from './photocraft.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';

const NAME = 'event-day';
const REFRESH_MS = 30_000;

const settings = loadSettings(process.env);
const quietMs = settings.quietMinutes * 60_000;
const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();
const photoCraft =
  settings.photoCraftUrl === undefined
    ? undefined
    : new PhotoCraft({ appUrl: settings.photoCraftUrl });
const { challenge } = settings;

const poller = createPoller<EventSnapshot>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: createEventFetch({
    name: NAME,
    booths: settings.booths,
    boothStatus:
      photoCraft === undefined
        ? undefined
        : (booth, fetchSignal) => photoCraft.status(booth, fetchSignal),
    challenge:
      challenge === undefined
        ? undefined
        : (fetchSignal) =>
            fetchChallenge({ ...challenge, signal: fetchSignal }),
    quietMs,
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
    render: (now) =>
      render(now, poller.latest(), poller.failure(), { quietMs }),
    intervalMs: 1000,
    priority: settings.priority,
    signal,
  }),
]);
