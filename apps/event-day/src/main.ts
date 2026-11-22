import {
  createBusyBar,
  createPoller,
  createSpeaker,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchChallenge } from './challenge.ts';
import type { EventSnapshot } from './event.ts';
import { createEventFetch } from './event.ts';
import type { BoothRef } from './photocraft.ts';
import { PhotoCraft } from './photocraft.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';

const NAME = 'event-day';
const REFRESH_MS = 30_000;

function readBooths(appUrl: string, booths: readonly BoothRef[]) {
  const client = new PhotoCraft({ name: NAME, appUrl });
  return {
    booths,
    status: (booth: BoothRef, fetchSignal: AbortSignal) =>
      client.status(booth, fetchSignal),
  };
}

const settings = loadSettings(process.env);
const quietMs = settings.quietMinutes * 60_000;
const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();
const { photoCraft, challenge } = settings;
const speaker = createSpeaker({
  name: NAME,
  client: bar,
  enabled: settings.sound,
  signal,
});

const poller = createPoller<EventSnapshot>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: createEventFetch({
    name: NAME,
    photoCraft:
      photoCraft === undefined
        ? undefined
        : readBooths(photoCraft.url, photoCraft.booths),
    challenge:
      challenge === undefined
        ? undefined
        : (fetchSignal) =>
            fetchChallenge({ ...challenge, signal: fetchSignal }),
    quietMs,
    play: speaker.play,
  }),
});

await Promise.all([
  poller.run(signal),
  runBarApp({
    name: NAME,
    client: bar,
    render: (now) => render(now, poller.latest(), { quietMs }),
    intervalMs: 1000,
    priority: settings.priority,
    signal,
  }),
]);
