import type {
  BarElements,
  BarFont,
  PollFailure,
  Snapshot,
} from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  fitText,
  FOOTER_Y,
  FRONT_DISPLAY,
  PALETTE,
  rgba,
  statusCells,
  SUMMARY_Y,
  textElement,
  textWidth,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { Checks, OpenPullRequest } from './github.ts';
import { GitHubError } from './github.ts';
import type { TickerState } from './watch.ts';

export const MERGED_COLOR = PALETTE.good;
export const CHECK_COLORS: Readonly<Record<Checks, string>> = {
  passing: PALETTE.good,
  failing: PALETTE.bad,
  pending: PALETTE.warn,
  none: PALETTE.idle,
};
export const QUEUED_COLOR = PALETTE.info;
const DRAFT_COLOR = rgba(50, 50, 50);

/** How long a newly noticed merge takes over the display. */
export const CELEBRATION_MS = 15_000;
/** How long GitHub may stay unreachable before the board says so. */
export const STALE_MS = 5 * 60_000;

const CELL_PITCH = 4;
export const MAX_CELLS = FRONT_DISPLAY.width / CELL_PITCH;
const FIRST_ROW_Y = 12;
const ROW_PITCH = 10;
const MAX_ROWS = Math.floor((FOOTER_Y - FIRST_ROW_Y) / ROW_PITCH);
const REF_X = 24;
const TITLE_X = 82;

/**
 * Today's merge count in front, beside what most needs you: failing checks,
 * then the auto-merge queue, then everything open. The open pull requests
 * are listed behind.
 */
export function render(
  now: Date,
  latest: Snapshot<TickerState> | undefined,
  failure: PollFailure | undefined,
): BarElements {
  if (latest === undefined) {
    return unavailable(failure);
  }
  const { pulls, celebration } = latest.value;
  const celebrating =
    celebration !== undefined &&
    now.getTime() - celebration.noticedAt.getTime() < CELEBRATION_MS;
  const failing = pulls.open.filter((pull) => pull.checks === 'failing');
  const queued = pulls.open.filter(
    (pull) => pull.autoMerge && pull.checks !== 'failing',
  );

  const count = String(pulls.mergedToday);
  const textX = textWidth(count, 'large') + 3;
  const width = FRONT_DISPLAY.width - textX;
  let headline: string;
  let color: string;
  let focus: string;
  if (celebrating) {
    headline = 'MERGED!';
    color = MERGED_COLOR;
    focus = fitReference(celebration.merge, 'tiny', width);
  } else if (failing[0] !== undefined) {
    headline = `${failing.length} FAILING`;
    color = CHECK_COLORS.failing;
    focus = fitReference(failing[0], 'tiny', width);
  } else if (queued[0] !== undefined) {
    headline = `${queued.length} QUEUED`;
    color = QUEUED_COLOR;
    focus = fitReference(queued[0], 'tiny', width);
  } else if (pulls.open[0] !== undefined) {
    headline = `${pulls.openCount} OPEN`;
    color = PALETTE.text;
    focus = fitReference(pulls.open[0], 'tiny', width);
  } else {
    headline = 'NONE OPEN';
    color = PALETTE.idle;
    focus = 'merged today';
  }

  const elements: BarElements = [
    textElement({
      id: 'count',
      text: count,
      display: 'front',
      font: 'large',
      x: 0,
      y: 0,
      color: pulls.mergedToday > 0 ? MERGED_COLOR : PALETTE.idle,
    }),
    textElement({
      id: 'headline',
      text: fitText(headline, 'small', width),
      display: 'front',
      font: 'small',
      x: textX,
      y: 0,
      color,
    }),
    textElement({
      id: 'focus',
      text: focus,
      display: 'front',
      font: 'tiny',
      x: textX,
      y: SUMMARY_Y,
      color,
    }),
    ...statusCells(
      pulls.open
        .slice(0, MAX_CELLS)
        .map((pull) => (pull.draft ? DRAFT_COLOR : CHECK_COLORS[pull.checks])),
      { pitch: CELL_PITCH, width: CELL_PITCH - 1 },
    ),
  ];

  const header = celebrating
    ? `Merged ${reference(celebration.merge)}!`
    : `${pulls.mergedToday} merged today, ${pulls.openCount} open`;
  const stale =
    failure !== undefined && now.getTime() - latest.at.getTime() > STALE_MS;
  const footer = stale
    ? 'GitHub unreachable, showing old data'
    : `updated ${minutesAgo(now, latest.at)}`;
  elements.push(
    textElement({
      id: 'header',
      text: fitText(header, 'small', BACK_DISPLAY.width),
      display: 'back',
      font: 'small',
      x: 0,
      y: 0,
    }),
    ...pulls.open.slice(0, MAX_ROWS).flatMap((pull, index) => row(index, pull)),
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

/** `name#123`: the repository without its owner, and the number. */
export function reference(pull: {
  readonly repo: string;
  readonly number: number;
}): string {
  const name = pull.repo.slice(pull.repo.indexOf('/') + 1);
  return `${toBarText(name)}#${pull.number}`;
}

/**
 * {@link reference} cut to `width` pixels. The repository name gives way and
 * the number stays, since the number is what finds the pull request.
 */
function fitReference(
  pull: { readonly repo: string; readonly number: number },
  font: BarFont,
  width: number,
): string {
  const full = reference(pull);
  if (textWidth(full, font) <= width) {
    return full;
  }
  const number = `#${pull.number}`;
  const name = full.slice(0, -number.length);
  return fitText(name, font, width - textWidth(number, font)) + number;
}

function row(index: number, pull: OpenPullRequest): BarElements {
  const y = FIRST_ROW_Y + index * ROW_PITCH;
  const color = pull.checks === 'failing' ? PALETTE.text : PALETTE.dim;
  return [
    textElement({
      id: `row-${index}-tag`,
      text: tag(pull),
      display: 'back',
      font: 'small',
      x: 0,
      y,
      color: pull.autoMerge && pull.checks !== 'failing' ? QUEUED_COLOR : color,
    }),
    textElement({
      id: `row-${index}-ref`,
      text: fitReference(pull, 'small', TITLE_X - REF_X - 4),
      display: 'back',
      font: 'small',
      x: REF_X,
      y,
      color,
    }),
    textElement({
      id: `row-${index}-title`,
      text: fitText(pull.title, 'small', BACK_DISPLAY.width - TITLE_X),
      display: 'back',
      font: 'small',
      x: TITLE_X,
      y,
      color,
    }),
  ];
}

function tag(pull: OpenPullRequest): string {
  if (pull.checks === 'failing') {
    return 'FAIL';
  }
  if (pull.autoMerge) {
    return 'auto';
  }
  if (pull.draft) {
    return 'draft';
  }
  return { passing: 'ok', pending: 'wait', none: '-' }[pull.checks];
}

function minutesAgo(now: Date, then: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / 60_000),
  );
  return minutes === 0 ? 'just now' : `${minutes}m ago`;
}

function unavailable(failure: PollFailure | undefined): BarElements {
  let summary: string;
  let lines: readonly string[];
  if (failure === undefined) {
    summary = 'loading';
    lines = ['Asking GitHub for your pull requests'];
  } else if (
    failure.error instanceof GitHubError &&
    failure.error.status === 401
  ) {
    summary = 'token rejected';
    lines = [
      'GitHub rejected GITHUB_TOKEN.',
      'Try GITHUB_TOKEN=$(gh auth token).',
    ];
  } else {
    summary = 'unreachable';
    lines = ['Cannot reach GitHub:', failure.error.message];
  }
  return [
    textElement({
      id: 'headline',
      text: 'GITHUB',
      display: 'front',
      font: 'small',
      x: 0,
      y: 0,
      color: PALETTE.idle,
    }),
    textElement({
      id: 'summary',
      text: summary,
      display: 'front',
      font: 'tiny',
      x: 0,
      y: SUMMARY_Y,
      color: PALETTE.idle,
    }),
    ...lines.map((line, index) =>
      textElement({
        id: `line-${index}`,
        text: fitText(toBarText(line), 'small', BACK_DISPLAY.width),
        display: 'back',
        font: 'small',
        x: 0,
        y: index * ROW_PITCH,
      }),
    ),
  ];
}
