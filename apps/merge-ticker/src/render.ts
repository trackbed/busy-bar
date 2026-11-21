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
  textWidth,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { Checks, OpenPullRequest } from './github.ts';
import { GitHubError } from './github.ts';
import type { TickerState } from './watch.ts';

export const MERGED_COLOR = rgba(0, 210, 90);
export const CHECK_COLORS: Readonly<Record<Checks, string>> = {
  passing: rgba(0, 210, 90),
  failing: rgba(255, 60, 60),
  pending: rgba(255, 170, 0),
  none: rgba(110, 110, 110),
};
export const QUEUED_COLOR = rgba(60, 130, 255);
const DRAFT_COLOR = rgba(50, 50, 50);
const IDLE_COLOR = rgba(110, 110, 110);
const TEXT_COLOR = rgba(200, 200, 200);
const DIM_COLOR = rgba(120, 120, 120);

/** How long a newly noticed merge takes over the display. */
export const CELEBRATION_MS = 15_000;
/** How long GitHub may stay unreachable before the board says so. */
export const STALE_MS = 5 * 60_000;

const SUMMARY_Y = 9;
const CELL_PITCH = 4;
export const MAX_CELLS = FRONT_DISPLAY.width / CELL_PITCH;
const FIRST_ROW_Y = 12;
const ROW_PITCH = 10;
const FOOTER_Y = BACK_DISPLAY.height - 7;
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
    color = TEXT_COLOR;
    focus = fitReference(pulls.open[0], 'tiny', width);
  } else {
    headline = 'NONE OPEN';
    color = IDLE_COLOR;
    focus = 'merged today';
  }

  const elements: BarElements = [
    text('count', count, 'front', 'large', 0, 0, {
      color: pulls.mergedToday > 0 ? MERGED_COLOR : IDLE_COLOR,
    }),
    text(
      'headline',
      fitText(headline, 'small', width),
      'front',
      'small',
      textX,
      0,
      {
        color,
      },
    ),
    text('focus', focus, 'front', 'tiny', textX, SUMMARY_Y, {
      color,
    }),
    ...pulls.open.slice(0, MAX_CELLS).map((pull, index) => ({
      id: `cell-${index}`,
      type: 'rectangle' as const,
      display: 'front' as const,
      x: index * CELL_PITCH,
      y: FRONT_DISPLAY.height - 1,
      width: CELL_PITCH - 1,
      height: 1,
      fill: 'solid' as const,
      fill_colors: [pull.draft ? DRAFT_COLOR : CHECK_COLORS[pull.checks]],
      border_width: 0,
    })),
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
    text(
      'header',
      fitText(header, 'small', BACK_DISPLAY.width),
      'back',
      'small',
      0,
      0,
    ),
    ...pulls.open.slice(0, MAX_ROWS).flatMap((pull, index) => row(index, pull)),
    text('footer', footer, 'back', 'tiny', 0, FOOTER_Y, { color: DIM_COLOR }),
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
  const color = pull.checks === 'failing' ? TEXT_COLOR : DIM_COLOR;
  return [
    text(`row-${index}-tag`, tag(pull), 'back', 'small', 0, y, {
      color: pull.autoMerge && pull.checks !== 'failing' ? QUEUED_COLOR : color,
    }),
    text(
      `row-${index}-ref`,
      fitReference(pull, 'small', TITLE_X - REF_X - 4),
      'back',
      'small',
      REF_X,
      y,
      { color },
    ),
    text(
      `row-${index}-title`,
      fitText(pull.title, 'small', BACK_DISPLAY.width - TITLE_X),
      'back',
      'small',
      TITLE_X,
      y,
      { color },
    ),
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
    text('headline', 'GITHUB', 'front', 'small', 0, 0, { color: IDLE_COLOR }),
    text('summary', summary, 'front', 'tiny', 0, SUMMARY_Y, {
      color: IDLE_COLOR,
    }),
    ...lines.map((line, index) =>
      text(
        `line-${index}`,
        fitText(toBarText(line), 'small', BACK_DISPLAY.width),
        'back',
        'small',
        0,
        index * ROW_PITCH,
      ),
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
  { color = TEXT_COLOR }: { readonly color?: string } = {},
): TextElement {
  return { id, type: 'text', display, text: content, font, color, x, y };
}
