import {
  createBusyBar,
  createPoller,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchChallenge } from './challenge.ts';
import type { Alert, EventSnapshot } from './event.ts';
import { EventWatch } from './event.ts';
import { PhotoCraft } from './photocraft.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';

const NAME = 'event-day';
const REFRESH_MS = 30_000;

// Built-in sounds every bar ships.
const SOUNDS: Readonly<Record<Alert, string>> = {
  quiet: 'shared/sounds/calendar_reminder_ends.snd',
  down: 'shared/sounds/calendar_event_starts.snd',
};

const settings = loadSettings(process.env);
const quietMs = settings.quietMinutes * 60_000;
const bar = createBusyBar(loadBarConfig());
const signal = shutdownSignal();
const photoCraft =
  settings.photoCraftUrl === undefined
    ? undefined
    : new PhotoCraft({ appUrl: settings.photoCraftUrl });
const watch = new EventWatch(quietMs);

async function readChallenge(
  fetchSignal: AbortSignal,
): Promise<Pick<EventSnapshot, 'challenge' | 'challengeProblem'>> {
  if (settings.challenge === undefined) {
    return { challenge: undefined, challengeProblem: undefined };
  }
  try {
    const challenge = await fetchChallenge({
      ...settings.challenge,
      signal: fetchSignal,
    });
    return { challenge, challengeProblem: undefined };
  } catch (error) {
    if (fetchSignal.aborted) {
      throw error;
    }
    const problem = error instanceof Error ? error.message : String(error);
    return { challenge: undefined, challengeProblem: problem };
  }
}

const poller = createPoller<EventSnapshot>({
  name: NAME,
  intervalMs: REFRESH_MS,
  fetch: async (fetchSignal) => {
    const [booths, challenge] = await Promise.all([
      Promise.all(
        settings.booths.map((booth) =>
          photoCraft === undefined
            ? Promise.reject(new Error('No PhotoCraft URL'))
            : photoCraft.status(booth, fetchSignal),
        ),
      ),
      readChallenge(fetchSignal),
    ]);
    const snapshot: EventSnapshot = { booths, ...challenge };
    const alert = watch.observe(snapshot, new Date());
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
    return snapshot;
  },
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
