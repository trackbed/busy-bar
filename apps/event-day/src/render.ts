import type {
  BarElements,
  PollFailure,
  Snapshot,
} from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  fitText,
  FOOTER_Y,
  FRONT_DISPLAY,
  PALETTE,
  statusCells,
  SUMMARY_Y,
  textElement,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { ChallengeStatus } from './challenge.ts';
import type { BoothView, EventSnapshot } from './event.ts';
import { boothView } from './event.ts';
import type { BoothStatus } from './photocraft.ts';
import { GALLERY_LIMIT } from './photocraft.ts';

export const VIEW_COLORS: Readonly<Record<BoothView, string>> = {
  live: PALETTE.good,
  quiet: PALETTE.warn,
  off: PALETTE.idle,
  missing: PALETTE.bad,
  error: PALETTE.bad,
};

/** How long each booth stays on the front's second line. */
export const ROTATE_MS = 4000;
/** How long PhotoCraft may stay unreachable before the board says so. */
export const STALE_MS = 2 * 60_000;

const CELL_PITCH = 4;
const ROW_PITCH = 10;
const FIRST_ROW_Y = 12;
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
  const event = latest.value;
  const views = event.booths.map((status) =>
    boothView(status, now, view.quietMs),
  );
  const stale =
    failure !== undefined && now.getTime() - latest.at.getTime() > STALE_MS;
  const footer = stale
    ? 'Event Studio unreachable, showing old data'
    : updated(now, latest.at);
  return [...front(event, views, now), ...back(event, views, now, footer)];
}

/**
 * The front's second line at `now`: each booth in turn, then the challenge,
 * for {@link ROTATE_MS} each.
 */
export function rotatingLine(
  { booths, challenge }: EventSnapshot,
  views: readonly BoothView[],
  now: Date,
): string {
  const lines = [
    ...booths.map((status, index) =>
      boothLine(status, views[index] ?? status.state, now),
    ),
    ...(challenge === undefined ? [] : [challengeShort(challenge)]),
  ];
  return (
    lines[Math.floor(now.getTime() / ROTATE_MS) % Math.max(1, lines.length)] ??
    ''
  );
}

/**
 * The challenge's line behind: its leaderboard, or why it cannot be read.
 * Undefined when the event has no challenge.
 */
export function challengeText({
  challenge,
  challengeProblem,
}: EventSnapshot): string | undefined {
  if (challenge !== undefined) {
    return `Challenge: ${challengeLine(challenge)}`;
  }
  return challengeProblem === undefined
    ? undefined
    : `Challenge: ${toBarText(challengeProblem)}`;
}

function front(
  event: EventSnapshot,
  views: readonly BoothView[],
  now: Date,
): BarElements {
  const [headline, color] =
    event.booths.length > 0
      ? boothHeadline(event.booths, views, now)
      : challengeHeadline(event.challenge, event.challengeProblem);
  return [
    textElement({
      id: 'headline',
      text: fitText(headline, 'small', FRONT_DISPLAY.width),
      display: 'front',
      font: 'small',
      x: 0,
      y: 0,
      color,
    }),
    textElement({
      id: 'summary',
      text: fitText(
        rotatingLine(event, views, now),
        'tiny',
        FRONT_DISPLAY.width,
      ),
      display: 'front',
      font: 'tiny',
      x: 0,
      y: SUMMARY_Y,
      color,
    }),
    ...statusCells(
      views
        .slice(0, FRONT_DISPLAY.width / CELL_PITCH)
        .map((boothState) => VIEW_COLORS[boothState]),
      { pitch: CELL_PITCH, width: CELL_PITCH - 1 },
    ),
  ];
}

function back(
  event: EventSnapshot,
  views: readonly BoothView[],
  now: Date,
  footer: string,
): BarElements {
  const { booths } = event;
  const header =
    booths[0] === undefined
      ? 'ChallengeCraft'
      : `PhotoCraft: ${booths[0].booth.eventSlug}`;
  const elements: BarElements = [
    textElement({
      id: 'header',
      text: fitText(header, 'small', BACK_DISPLAY.width),
      display: 'back',
      font: 'small',
      x: 0,
      y: 0,
    }),
    ...booths
      .slice(0, MAX_BOOTH_ROWS)
      .flatMap((status, index) =>
        boothRow(index, status, views[index] ?? status.state, now),
      ),
  ];
  const challenge = challengeText(event);
  if (challenge !== undefined) {
    elements.push(
      textElement({
        id: 'challenge',
        text: fitText(challenge, 'small', BACK_DISPLAY.width),
        display: 'back',
        font: 'small',
        x: 0,
        y: FIRST_ROW_Y + Math.min(booths.length, MAX_BOOTH_ROWS) * ROW_PITCH,
      }),
    );
  }
  elements.push(
    textElement({
      id: 'footer',
      text: footer,
      display: 'back',
      font: 'tiny',
      x: 0,
      y: FOOTER_Y,
      color: PALETTE.dim,
    }),
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
  const color = boothState === 'live' ? PALETTE.text : PALETTE.dim;
  const last =
    status.latestPhotoAt === undefined ? '' : age(now, status.latestPhotoAt);
  return [
    textElement({
      id: `row-${index}-name`,
      text: fitText(status.booth.boothSlug, 'small', STATUS_X - 4),
      display: 'back',
      font: 'small',
      x: 0,
      y,
      color,
    }),
    textElement({
      id: `row-${index}-status`,
      text: WORDS[boothState],
      display: 'back',
      font: 'small',
      x: STATUS_X,
      y,
      color,
    }),
    textElement({
      id: `row-${index}-photos`,
      text: status.photos === undefined ? '' : photos(status),
      display: 'back',
      font: 'small',
      x: PHOTOS_RIGHT,
      y,
      color,
      align: 'top_right',
    }),
    textElement({
      id: `row-${index}-last`,
      text: last,
      display: 'back',
      font: 'small',
      x: BACK_DISPLAY.width - 1,
      y,
      color,
      align: 'top_right',
    }),
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
    textElement({
      id: 'headline',
      text: 'EVENT',
      display: 'front',
      font: 'small',
      x: 0,
      y: 0,
      color: VIEW_COLORS.off,
    }),
    textElement({
      id: 'summary',
      text: failure === undefined ? 'loading' : 'unreachable',
      display: 'front',
      font: 'tiny',
      x: 0,
      y: SUMMARY_Y,
      color: VIEW_COLORS.off,
    }),
    textElement({
      id: 'header',
      text: fitText(toBarText(reason), 'small', BACK_DISPLAY.width),
      display: 'back',
      font: 'small',
      x: 0,
      y: 0,
    }),
  ];
}
