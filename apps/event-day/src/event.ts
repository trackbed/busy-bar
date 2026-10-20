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

function key(booth: BoothRef): string {
  return `${booth.eventSlug}/${booth.boothSlug}`;
}
