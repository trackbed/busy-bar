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
  freshnessLine,
  rgba,
  solidRectangle,
  SUMMARY_Y,
  textElement,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { QueueCounts, QueueScope } from './linear.ts';
import { LinearError } from './linear.ts';

export const READY_COLORS = {
  plenty: PALETTE.good,
  low: PALETTE.warn,
  empty: PALETTE.bad,
} as const;
export const STAGE_COLORS = {
  ready: PALETTE.info,
  inProgress: PALETTE.warn,
  inReview: rgba(200, 80, 255),
} as const;

/** How long Linear may stay unreachable before the gauge says so. */
export const STALE_MS = 10 * 60_000;

const FIRST_ROW_Y = 12;
const ROW_PITCH = 11;

export interface QueueView {
  readonly scope: QueueScope;
  readonly low: number;
}

/**
 * The ready count in front, coloured by whether it is running low, over a
 * strip that splits the active queue into ready, in progress, and in review.
 * Every stage is listed behind.
 */
export function render(
  now: Date,
  latest: Snapshot<QueueCounts> | undefined,
  failure: PollFailure | undefined,
  view: QueueView,
): BarElements {
  if (latest === undefined) {
    return unavailable(failure);
  }
  const counts = latest.value;
  const more = counts.capped ? '+' : '';
  let color: string;
  if (counts.ready === 0) {
    color = READY_COLORS.empty;
  } else if (counts.ready < view.low) {
    color = READY_COLORS.low;
  } else {
    color = READY_COLORS.plenty;
  }
  const summary = `${counts.inProgress}${more} wip, ${counts.inReview}${more} review`;

  const elements: BarElements = [
    textElement({
      id: 'headline',
      text: `${counts.ready}${more} READY`,
      display: 'front',
      font: 'small',
      x: 0,
      y: 0,
      color,
    }),
    textElement({
      id: 'summary',
      text: fitText(summary, 'tiny', FRONT_DISPLAY.width),
      display: 'front',
      font: 'tiny',
      x: 0,
      y: SUMMARY_Y,
      color,
    }),
    ...strip(counts),
  ];

  const footer = freshnessLine('Linear', latest, failure, now, STALE_MS);
  const rows: readonly (readonly [string, number])[] = [
    [
      view.scope.label === undefined
        ? 'Ready (Todo)'
        : `Ready (${toBarText(view.scope.label)})`,
      counts.ready,
    ],
    ['In progress', counts.inProgress],
    ['In review', counts.inReview],
    ['Done, last 7 days', counts.doneThisWeek],
    ['Backlog', counts.backlog],
  ];
  elements.push(
    textElement({
      id: 'header',
      text: fitText(heading(view.scope), 'small', BACK_DISPLAY.width),
      display: 'back',
      font: 'small',
      x: 0,
      y: 0,
    }),
    ...rows.flatMap(([label, count], index) => {
      const y = FIRST_ROW_Y + index * ROW_PITCH;
      return [
        textElement({
          id: `row-${index}-label`,
          text: label,
          display: 'back',
          font: 'small',
          x: 0,
          y,
          color: PALETTE.dim,
        }),
        textElement({
          id: `row-${index}-count`,
          text: `${count}${more}`,
          display: 'back',
          font: 'small',
          x: BACK_DISPLAY.width - 1,
          y,
          align: 'top_right',
        }),
      ];
    }),
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

/** `DISC queue`, plus the label and assignee filters when set. */
export function heading(scope: QueueScope): string {
  const filters = [
    scope.label === undefined ? undefined : toBarText(scope.label),
    scope.mine ? 'mine' : undefined,
  ].filter((filter) => filter !== undefined);
  const team = toBarText(scope.team);
  return filters.length === 0
    ? `${team} queue`
    : `${team} queue: ${filters.join(', ')}`;
}

/** The ready, in-progress, and in-review shares of the bottom row. */
function strip(counts: QueueCounts): BarElements {
  const stages = [
    ['ready', counts.ready],
    ['inProgress', counts.inProgress],
    ['inReview', counts.inReview],
  ] as const;
  const total = stages.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    return [];
  }
  const elements: BarElements = [];
  let x = 0;
  let counted = 0;
  for (const [stage, count] of stages) {
    counted += count;
    const end = Math.round((counted / total) * FRONT_DISPLAY.width);
    if (end > x) {
      elements.push(
        solidRectangle({
          id: `strip-${stage}`,
          display: 'front',
          x,
          y: FRONT_DISPLAY.height - 1,
          width: end - x,
          height: 1,
          color: STAGE_COLORS[stage],
        }),
      );
    }
    x = end;
  }
  return elements;
}

function unavailable(failure: PollFailure | undefined): BarElements {
  let summary: string;
  let lines: readonly string[];
  if (failure === undefined) {
    summary = 'loading';
    lines = ['Counting the Linear queue'];
  } else if (
    failure.error instanceof LinearError &&
    (failure.error.status === 401 || failure.error.status === 400)
  ) {
    summary = 'key rejected';
    lines = [
      'Linear rejected the request.',
      'Check LINEAR_API_KEY and the team key.',
    ];
  } else {
    summary = 'unreachable';
    lines = ['Cannot reach Linear:', failure.error.message];
  }
  return [
    textElement({
      id: 'headline',
      text: 'LINEAR',
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
