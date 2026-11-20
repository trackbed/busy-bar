import type { MergedPullRequest, PullRequests } from './github.ts';
import { pullKey } from './github.ts';

/** A merge the ticker noticed, celebrated for a few seconds. */
export interface Celebration {
  readonly merge: MergedPullRequest;
  readonly noticedAt: Date;
}

/** What the ticker draws: the latest reading and any merge to celebrate. */
export interface TickerState {
  readonly pulls: PullRequests;
  readonly celebration: Celebration | undefined;
}

/** A change worth a sound: a merge, or a pull request whose checks broke. */
export type Alert = 'merged' | 'failing';

/** The built-in sound every bar ships for each alert. */
export const ALERT_SOUNDS: Readonly<Record<Alert, string>> = {
  merged: 'shared/sounds/calendar_event_starts.snd',
  failing: 'shared/sounds/calendar_reminder_ends.snd',
};

/**
 * Compares each reading with the one before it. The first reading only sets
 * the baseline, so starting the app does not celebrate the day's merges.
 */
export class MergeWatch {
  #previous: PullRequests | undefined;
  #celebration: Celebration | undefined;

  observe(
    pulls: PullRequests,
    now: Date,
  ): { readonly state: TickerState; readonly alert: Alert | undefined } {
    const previous = this.#previous;
    this.#previous = pulls;
    let alert: Alert | undefined;
    if (previous !== undefined) {
      const known = new Set(previous.merged.map(pullKey));
      const newMerge = pulls.merged.find((pull) => !known.has(pullKey(pull)));
      const failing = new Set(
        previous.open.filter((pull) => pull.checks === 'failing').map(pullKey),
      );
      if (newMerge !== undefined) {
        this.#celebration = { merge: newMerge, noticedAt: now };
        alert = 'merged';
      } else if (
        pulls.open.some(
          (pull) => pull.checks === 'failing' && !failing.has(pullKey(pull)),
        )
      ) {
        alert = 'failing';
      }
    }
    return { state: { pulls, celebration: this.#celebration }, alert };
  }
}

export interface TickerFetchOptions {
  /** Names the app in log messages. */
  readonly name: string;
  /** Reads the pull requests as of `now`, such as `fetchPullRequests`. */
  readonly pullRequests: (
    now: Date,
    signal: AbortSignal,
  ) => Promise<PullRequests>;
  /** Plays a stock sound, such as busy-lib's `AudioPlay`; unset when sounds are off. */
  readonly play: ((stockPath: string) => Promise<unknown>) | undefined;
  readonly now?: () => Date;
  readonly log?: Pick<Console, 'warn'>;
}

/**
 * One poll of the ticker for `createPoller`: read the pull requests, compare
 * them with the last reading, and play the sound for a new merge or newly
 * failing checks. A sound that fails to play is logged and the poll still
 * succeeds.
 */
export function createTickerFetch(
  options: TickerFetchOptions,
): (signal: AbortSignal) => Promise<TickerState> {
  const {
    name,
    pullRequests,
    play,
    now = () => new Date(),
    log = console,
  } = options;
  const watch = new MergeWatch();

  return async (signal) => {
    const at = now();
    const { state, alert } = watch.observe(await pullRequests(at, signal), at);
    if (alert !== undefined && play !== undefined) {
      try {
        await play(ALERT_SOUNDS[alert]);
      } catch (error) {
        log.warn(`[${name}] Playing a sound failed:`, error);
      }
    }
    return state;
  };
}
