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
