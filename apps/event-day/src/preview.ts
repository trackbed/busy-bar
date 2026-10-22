import type { BarElements, Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import type { ChallengeStatus } from './challenge.ts';
import type { EventSnapshot } from './event.ts';
import type { BoothStatus } from './photocraft.ts';
import { render } from './render.ts';

const QUIET_MS = 15 * 60_000;

const CHALLENGE: ChallengeStatus = {
  state: 'live',
  entries: 37,
  leader: { name: 'Anna', score: 980 },
};

function booth(
  boothSlug: string,
  now: Date,
  photos: number,
  minutesAgo: number,
): BoothStatus {
  return {
    booth: { eventSlug: 'summit-2026', boothSlug },
    state: 'live',
    photos,
    latestPhotoAt: new Date(now.getTime() - minutesAgo * 60_000),
    problem: undefined,
  };
}

/** Draw `value` as read 20 seconds before `now`. */
function draw(now: Date, value: EventSnapshot): BarElements {
  return render(
    now,
    { value, at: new Date(now.getTime() - 20_000) },
    undefined,
    { quietMs: QUIET_MS },
  );
}

// Each time is a whole number of 48-second rotation cycles (4 s per line, for
// one to four lines) plus a few seconds, so it picks a known second line.
const BUSY_AT = new Date('2026-10-21T10:00:00Z');
const QUIET_AT = new Date('2026-10-21T14:20:04Z');
const CHALLENGE_AT = new Date('2026-10-21T16:00:00Z');

/** Sample frames for the app catalogue: `nx run event-day:preview`. */
export function preview(): Preview {
  return {
    summary:
      'Whether the PhotoCraft booths and ChallengeCraft leaderboard at a Consensus Event Studio event are still running.',
    steps: [
      {
        label: 'Reads',
        text: 'Each booth in EVENT_DAY_BOOTHS through the public routes the PhotoCraft live wall uses, and the ChallengeCraft TV leaderboard through Convex, every 30 seconds.',
      },
      {
        label: 'Decides',
        text: 'A live booth whose wall has had no new portrait for EVENT_DAY_QUIET_MINUTES (15 by default) counts as quiet, since PhotoCraft reports no heartbeat.',
      },
      {
        label: 'Draws',
        text: 'Live booths and their portrait count on the front in the colour of the worst booth, each booth in turn below, one cell per booth along the bottom, and every booth and the challenge on the back.',
      },
      {
        label: 'Alerts',
        text: 'Plays a sound when a live booth goes quiet, cannot be read, or disappears, unless EVENT_DAY_SOUND is off.',
      },
    ],
    scenes: [
      {
        title: 'Booths live',
        caption:
          'All three booths are publishing portraits, so the headline and every cell are green; the busiest wall has reached 200+.',
        elements: draw(BUSY_AT, {
          booths: [
            booth('main-stage', BUSY_AT, 148, 1),
            booth('lounge', BUSY_AT, 96, 3),
            booth('entrance', BUSY_AT, 200, 2),
          ],
          challenge: CHALLENGE,
          challengeProblem: undefined,
        }),
      },
      {
        title: 'One gone quiet',
        caption:
          'The lounge wall has not moved for 22 minutes, so its cell and the headline turn amber and the second line names it.',
        elements: draw(QUIET_AT, {
          booths: [
            booth('main-stage', QUIET_AT, 171, 2),
            booth('lounge', QUIET_AT, 104, 22),
            booth('entrance', QUIET_AT, 200, 1),
          ],
          challenge: undefined,
          challengeProblem: undefined,
        }),
      },
      {
        title: 'Leaderboard only',
        caption:
          'Without booths, the front shows the live challenge, its entry count, and who leads.',
        elements: draw(CHALLENGE_AT, {
          booths: [],
          challenge: CHALLENGE,
          challengeProblem: undefined,
        }),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
