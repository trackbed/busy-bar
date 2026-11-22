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
  freshnessLine,
  rgba,
  SetupError,
  statusCells,
  SUMMARY_Y,
  textElement,
  textWidth,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { Checks, OpenPullRequest, PullRequests } from './github.ts';
import type { Celebration, TickerState } from './watch.ts';

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
    now.getTime() - celebration.noticedAt.getTime() < CELEBRATION_MS
      ? celebration
      : undefined;
  const footer = freshnessLine('GitHub', latest, failure, now, STALE_MS);
  return [
    ...front(pulls, focusOf(pulls, celebrating)),
    ...back(pulls, celebrating, footer),
  ];
}

/** What the front's headline says, and the pull request it names below. */
export interface Focus {
  readonly headline: string;
  readonly color: string;
  /** Undefined when nothing is open. */
  readonly pull: { readonly repo: string; readonly number: number } | undefined;
}

/**
 * What most needs you: a merge being celebrated, then failing checks, then
 * the auto-merge queue, then everything open.
 */
export function focusOf(
  pulls: PullRequests,
  celebrating: Celebration | undefined,
): Focus {
  const failing = pulls.open.filter((pull) => pull.checks === 'failing');
  const queued = pulls.open.filter(
    (pull) => pull.autoMerge && pull.checks !== 'failing',
  );
  if (celebrating !== undefined) {
    return {
      headline: 'MERGED!',
      color: MERGED_COLOR,
      pull: celebrating.merge,
    };
  }
  if (failing[0] !== undefined) {
    return {
      headline: `${failing.length} FAILING`,
      color: CHECK_COLORS.failing,
      pull: failing[0],
    };
  }
  if (queued[0] !== undefined) {
    return {
      headline: `${queued.length} QUEUED`,
      color: QUEUED_COLOR,
      pull: queued[0],
    };
  }
  if (pulls.open[0] !== undefined) {
    return {
      headline: `${pulls.openCount} OPEN`,
      color: PALETTE.text,
      pull: pulls.open[0],
    };
  }
  return { headline: 'NONE OPEN', color: PALETTE.idle, pull: undefined };
}

function front(pulls: PullRequests, focus: Focus): BarElements {
  const count = String(pulls.mergedToday);
  const textX = textWidth(count, 'large') + 3;
  const width = FRONT_DISPLAY.width - textX;
  return [
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
      text: fitText(focus.headline, 'small', width),
      display: 'front',
      font: 'small',
      x: textX,
      y: 0,
      color: focus.color,
    }),
    textElement({
      id: 'focus',
      text:
        focus.pull === undefined
          ? 'merged today'
          : fitReference(focus.pull, 'tiny', width),
      display: 'front',
      font: 'tiny',
      x: textX,
      y: SUMMARY_Y,
      color: focus.color,
    }),
    ...statusCells(
      pulls.open
        .slice(0, MAX_CELLS)
        .map((pull) => (pull.draft ? DRAFT_COLOR : CHECK_COLORS[pull.checks])),
      { pitch: CELL_PITCH, width: CELL_PITCH - 1 },
    ),
  ];
}

function back(
  pulls: PullRequests,
  celebrating: Celebration | undefined,
  footer: string,
): BarElements {
  const header =
    celebrating === undefined
      ? `${pulls.mergedToday} merged today, ${pulls.openCount} open`
      : `Merged ${reference(celebrating.merge)}!`;
  return [
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
  ];
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

function unavailable(failure: PollFailure | undefined): BarElements {
  let summary: string;
  let lines: readonly string[];
  if (failure === undefined) {
    summary = 'loading';
    lines = ['Asking GitHub for your pull requests'];
  } else if (failure.error instanceof SetupError) {
    summary = failure.error.summary;
    lines = failure.error.lines;
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
