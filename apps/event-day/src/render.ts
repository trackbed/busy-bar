import type {
  BarElements,
  BarFont,
  PollFailure,
  Snapshot,
  TextElement,
} from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  fitText,
  rgba,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { ChallengeStatus } from './challenge.ts';
import type { BoothView, EventSnapshot } from './event.ts';
import { boothView } from './event.ts';
import type { BoothStatus } from './photocraft.ts';
import { GALLERY_LIMIT } from './photocraft.ts';

export const VIEW_COLORS: Readonly<Record<BoothView, string>> = {
  live: rgba(0, 200, 90),
  quiet: rgba(255, 170, 0),
  off: rgba(110, 110, 110),
  missing: rgba(255, 60, 60),
  error: rgba(255, 60, 60),
};
const TEXT_COLOR = rgba(200, 200, 200);
const DIM_COLOR = rgba(120, 120, 120);

/** How long each booth stays on the front's second line. */
export const ROTATE_MS = 4000;
/** How long PhotoCraft may stay unreachable before the board says so. */
export const STALE_MS = 2 * 60_000;

const SUMMARY_Y = 9;
const CELL_PITCH = 4;
const ROW_PITCH = 10;
const FIRST_ROW_Y = 12;
const FOOTER_Y = BACK_DISPLAY.height - 7;
const MAX_BOOTH_ROWS = 4;
const STATUS_X = 62;
const PHOTOS_RIGHT = 124;

// Worst first: the headline takes the colour of the worst booth.
const SEVERITY: readonly BoothView[] = [
  'error',
  'missing',
  'quiet',
  'live',
  'off',
];

const WORDS: Readonly<Record<BoothView, string>> = {
  live: 'live',
  quiet: 'quiet',
  off: 'off',
  missing: 'not found',
  error: 'error',
};

export interface EventView {
  /** A live booth with no new portrait for this long counts as quiet. */
  readonly quietMs: number;
}

/**
 * The booths in front: how many are live and how many portraits they have
 * published, with each booth in turn on the second line and one cell per
 * booth on the bottom row. Without booths, the challenge leaderboard takes
 * the front. Every booth and the challenge are listed behind.
 */
export function render(
  now: Date,
  latest: Snapshot<EventSnapshot> | undefined,
  failure: PollFailure | undefined,
  view: EventView,
): BarElements {
  if (latest === undefined) {
    return unavailable(failure);
  }
  const { booths, challenge, challengeProblem } = latest.value;
  const views = booths.map((status) => boothView(status, now, view.quietMs));
  const lines = [
    ...booths.map((status, index) =>
      boothLine(status, views[index] ?? status.state, now),
    ),
    ...(challenge === undefined ? [] : [challengeShort(challenge)]),
  ];
  const rotating =
    lines[Math.floor(now.getTime() / ROTATE_MS) % Math.max(1, lines.length)] ??
    '';

  const [headline, color] =
    booths.length > 0
      ? boothHeadline(booths, views, now)
      : challengeHeadline(challenge, challengeProblem);
  const elements: BarElements = [
    text(
      'headline',
      fitText(headline, 'small', FRONT_DISPLAY.width),
      'front',
      'small',
      0,
      0,
      color,
    ),
    text(
      'summary',
      fitText(rotating, 'tiny', FRONT_DISPLAY.width),
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      color,
    ),
    ...views
      .slice(0, FRONT_DISPLAY.width / CELL_PITCH)
      .map((boothState, index) => ({
        id: `cell-${index}`,
        type: 'rectangle' as const,
        display: 'front' as const,
        x: index * CELL_PITCH,
        y: FRONT_DISPLAY.height - 1,
        width: CELL_PITCH - 1,
        height: 1,
        fill: 'solid' as const,
        fill_colors: [VIEW_COLORS[boothState]],
        border_width: 0,
      })),
  ];

  const header =
    booths[0] === undefined
      ? 'ChallengeCraft'
      : `PhotoCraft: ${booths[0].booth.eventSlug}`;
  elements.push(
    text(
      'header',
      fitText(header, 'small', BACK_DISPLAY.width),
      'back',
      'small',
      0,
      0,
    ),
    ...booths
      .slice(0, MAX_BOOTH_ROWS)
      .flatMap((status, index) =>
        boothRow(index, status, views[index] ?? status.state, now),
      ),
  );
  const challengeY =
    FIRST_ROW_Y + Math.min(booths.length, MAX_BOOTH_ROWS) * ROW_PITCH;
  if (challenge !== undefined || challengeProblem !== undefined) {
    const challengeText =
      challenge === undefined
        ? `Challenge: ${toBarText(challengeProblem ?? '')}`
        : `Challenge: ${challengeLine(challenge)}`;
    elements.push(
      text(
        'challenge',
        fitText(challengeText, 'small', BACK_DISPLAY.width),
        'back',
        'small',
        0,
        challengeY,
      ),
    );
  }
  const stale =
    failure !== undefined && now.getTime() - latest.at.getTime() > STALE_MS;
  elements.push(
    text(
      'footer',
      stale
        ? 'Event Studio unreachable, showing old data'
        : updated(now, latest.at),
      'back',
      'tiny',
      0,
      FOOTER_Y,
      DIM_COLOR,
    ),
  );
  return elements;
}

function updated(now: Date, then: Date): string {
  const since = age(now, then);
  return since === 'now' ? 'updated just now' : `updated ${since} ago`;
}

/** `now`, then whole minutes or hours. */
export function age(now: Date, then: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / 60_000),
  );
  if (minutes === 0) {
    return 'now';
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

function boothHeadline(
  booths: readonly BoothStatus[],
  views: readonly BoothView[],
  now: Date,
): readonly [string, string] {
  const worst = SEVERITY.find((severity) => views.includes(severity)) ?? 'off';
  const [only] = booths;
  if (booths.length === 1 && only !== undefined) {
    if (worst === 'live') {
      return [`LIVE ${photos(only)}`, VIEW_COLORS.live];
    }
    if (worst === 'quiet') {
      const since =
        only.latestPhotoAt === undefined ? '' : age(now, only.latestPhotoAt);
      return [`QUIET ${since}`.trim(), VIEW_COLORS.quiet];
    }
    return [WORDS[worst].toUpperCase(), VIEW_COLORS[worst]];
  }
  const live = views.filter(
    (boothState) => boothState === 'live' || boothState === 'quiet',
  ).length;
  const total = booths.reduce((sum, status) => sum + (status.photos ?? 0), 0);
  return [`${live}/${booths.length} LIVE ${total}`, VIEW_COLORS[worst]];
}

function challengeHeadline(
  challenge: ChallengeStatus | undefined,
  problem: string | undefined,
): readonly [string, string] {
  if (challenge === undefined) {
    return [
      problem === undefined ? 'CHALLENGE' : 'CHALLENGE ?',
      VIEW_COLORS.error,
    ];
  }
  const color = challenge.state === 'live' ? VIEW_COLORS.live : VIEW_COLORS.off;
  return [
    `${challenge.state.toUpperCase()} ${challenge.entries ?? ''}`.trim(),
    color,
  ];
}

function boothLine(
  status: BoothStatus,
  boothState: BoothView,
  now: Date,
): string {
  const name = status.booth.boothSlug;
  if (boothState === 'live' || boothState === 'quiet') {
    return status.latestPhotoAt === undefined
      ? `${name} no photos yet`
      : `${name} last ${age(now, status.latestPhotoAt)}`;
  }
  return `${name} ${WORDS[boothState]}`;
}

function challengeLine(challenge: ChallengeStatus): string {
  const entries =
    challenge.entries === undefined ? '' : `, ${challenge.entries} entries`;
  const leader =
    challenge.leader === undefined
      ? ''
      : `, top ${challenge.leader.name} ${challenge.leader.score}`;
  return `${challenge.state}${entries}${leader}`;
}

/** The leader, or the entry count: what fits on the front. */
function challengeShort(challenge: ChallengeStatus): string {
  if (challenge.leader !== undefined) {
    return `#1 ${challenge.leader.name} ${challenge.leader.score}`;
  }
  return `${challenge.entries ?? 0} entries`;
}

function boothRow(
  index: number,
  status: BoothStatus,
  boothState: BoothView,
  now: Date,
): BarElements {
  const y = FIRST_ROW_Y + index * ROW_PITCH;
  const color = boothState === 'live' ? TEXT_COLOR : DIM_COLOR;
  const last =
    status.latestPhotoAt === undefined ? '' : age(now, status.latestPhotoAt);
  return [
    text(
      `row-${index}-name`,
      fitText(status.booth.boothSlug, 'small', STATUS_X - 4),
      'back',
      'small',
      0,
      y,
      color,
    ),
    text(
      `row-${index}-status`,
      WORDS[boothState],
      'back',
      'small',
      STATUS_X,
      y,
      color,
    ),
    {
      ...text(
        `row-${index}-photos`,
        status.photos === undefined ? '' : photos(status),
        'back',
        'small',
        PHOTOS_RIGHT,
        y,
        color,
      ),
      align: 'top_right' as const,
    },
    {
      ...text(
        `row-${index}-last`,
        last,
        'back',
        'small',
        BACK_DISPLAY.width - 1,
        y,
        color,
      ),
      align: 'top_right' as const,
    },
  ];
}

/** The portrait count, with `+` once it reaches what one request returns. */
function photos(status: BoothStatus): string {
  const count = status.photos ?? 0;
  return count >= GALLERY_LIMIT ? `${GALLERY_LIMIT}+` : String(count);
}

function unavailable(failure: PollFailure | undefined): BarElements {
  const reason = failure === undefined ? 'loading' : failure.error.message;
  return [
    text('headline', 'EVENT', 'front', 'small', 0, 0, VIEW_COLORS.off),
    text(
      'summary',
      failure === undefined ? 'loading' : 'unreachable',
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      VIEW_COLORS.off,
    ),
    text(
      'header',
      fitText(toBarText(reason), 'small', BACK_DISPLAY.width),
      'back',
      'small',
      0,
      0,
    ),
  ];
}

function text(
  id: string,
  content: string,
  display: 'front' | 'back',
  font: BarFont,
  x: number,
  y: number,
  color: string = TEXT_COLOR,
): TextElement {
  return { id, type: 'text', display, text: content, font, color, x, y };
}
