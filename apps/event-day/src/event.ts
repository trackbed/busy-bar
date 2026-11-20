import type { ChallengeStatus } from './challenge.ts';
import type { BoothRef, BoothState, BoothStatus } from './photocraft.ts';

/** Everything the board draws, read in one poll. */
export interface EventSnapshot {
  readonly booths: readonly BoothStatus[];
  readonly challenge: ChallengeStatus | undefined;
  /** Why the challenge could not be read, if it is configured and failed. */
  readonly challengeProblem: string | undefined;
}

/** A booth's state with `quiet` for a live booth whose wall stopped moving. */
export type BoothView = BoothState | 'quiet';

/** A change worth a sound: a booth went quiet, or stopped answering. */
export type Alert = 'quiet' | 'down';

/** The built-in sound every bar ships for each alert. */
export const ALERT_SOUNDS: Readonly<Record<Alert, string>> = {
  quiet: 'shared/sounds/calendar_reminder_ends.snd',
  down: 'shared/sounds/calendar_event_starts.snd',
};

/**
 * How a booth looks at `now`. A live booth that has published before but not
 * for `quietMs` is quiet: the kiosk may have frozen, lost its camera, or
 * gone offline, since PhotoCraft reports no heartbeat of its own.
 */
export function boothView(
  status: BoothStatus,
  now: Date,
  quietMs: number,
): BoothView {
  if (
    status.state === 'live' &&
    status.latestPhotoAt !== undefined &&
    now.getTime() - status.latestPhotoAt.getTime() > quietMs
  ) {
    return 'quiet';
  }
  return status.state;
}

/** Compares polls and reports booths that just went quiet or down. */
export class EventWatch {
  readonly #quietMs: number;
  #previous = new Map<string, BoothView>();

  constructor(quietMs: number) {
    this.#quietMs = quietMs;
  }

  observe(snapshot: EventSnapshot, now: Date): Alert | undefined {
    const views = new Map(
      snapshot.booths.map((status) => [
        key(status.booth),
        boothView(status, now, this.#quietMs),
      ]),
    );
    let alert: Alert | undefined;
    for (const [booth, view] of views) {
      const before = this.#previous.get(booth);
      if (before !== 'live' || view === before) {
        continue;
      }
      if (view === 'error' || view === 'missing') {
        alert = 'down';
      } else if (view === 'quiet') {
        alert ??= 'quiet';
      }
    }
    this.#previous = views;
    return alert;
  }
}

export interface EventFetchOptions {
  /** Names the app in log messages. */
  readonly name: string;
  readonly booths: readonly BoothRef[];
  /** Reads one booth, such as `PhotoCraft.status`; unset without a PhotoCraft URL. */
  readonly boothStatus:
    | ((booth: BoothRef, signal: AbortSignal) => Promise<BoothStatus>)
    | undefined;
  /** Reads the leaderboard, such as `fetchChallenge`; unset without a challenge. */
  readonly challenge:
    | ((signal: AbortSignal) => Promise<ChallengeStatus>)
    | undefined;
  /** How long a live booth may go without a portrait before it is quiet. */
  readonly quietMs: number;
  /** Plays a stock sound, such as busy-lib's `AudioPlay`; unset when sounds are off. */
  readonly play: ((stockPath: string) => Promise<unknown>) | undefined;
  readonly now?: () => Date;
  readonly log?: Pick<Console, 'warn'>;
}

/**
 * One poll of the board for `createPoller`: every booth and the leaderboard,
 * then the sound for a booth that just went quiet or down. A booth that cannot
 * be read fails the poll; a leaderboard that cannot be read becomes
 * `challengeProblem`, so the booths still show. A sound that fails to play is
 * logged and the poll still succeeds.
 */
export function createEventFetch(
  options: EventFetchOptions,
): (signal: AbortSignal) => Promise<EventSnapshot> {
  const {
    name,
    booths,
    boothStatus,
    challenge,
    quietMs,
    play,
    now = () => new Date(),
    log = console,
  } = options;
  const watch = new EventWatch(quietMs);

  const readChallenge = async (
    signal: AbortSignal,
  ): Promise<Pick<EventSnapshot, 'challenge' | 'challengeProblem'>> => {
    if (challenge === undefined) {
      return { challenge: undefined, challengeProblem: undefined };
    }
    try {
      return {
        challenge: await challenge(signal),
        challengeProblem: undefined,
      };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const problem = error instanceof Error ? error.message : String(error);
      return { challenge: undefined, challengeProblem: problem };
    }
  };

  return async (signal) => {
    const [statuses, leaderboard] = await Promise.all([
      Promise.all(
        booths.map((booth) =>
          boothStatus === undefined
            ? Promise.reject(new Error('No PhotoCraft URL'))
            : boothStatus(booth, signal),
        ),
      ),
      readChallenge(signal),
    ]);
    const snapshot: EventSnapshot = { booths: statuses, ...leaderboard };
    const alert = watch.observe(snapshot, now());
    if (alert !== undefined && play !== undefined) {
      try {
        await play(ALERT_SOUNDS[alert]);
      } catch (error) {
        log.warn(`[${name}] Playing a sound failed:`, error);
      }
    }
    return snapshot;
  };
}

function key(booth: BoothRef): string {
  return `${booth.eventSlug}/${booth.boothSlug}`;
}
