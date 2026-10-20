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

import type { QueueCounts, QueueScope } from './linear.ts';
import { LinearError } from './linear.ts';

export const READY_COLORS = {
  plenty: rgba(0, 200, 90),
  low: rgba(255, 170, 0),
  empty: rgba(255, 60, 60),
} as const;
export const STAGE_COLORS = {
  ready: rgba(60, 130, 255),
  inProgress: rgba(255, 170, 0),
  inReview: rgba(200, 80, 255),
} as const;
const TEXT_COLOR = rgba(200, 200, 200);
const DIM_COLOR = rgba(120, 120, 120);
const IDLE_COLOR = rgba(110, 110, 110);

/** How long Linear may stay unreachable before the gauge says so. */
export const STALE_MS = 10 * 60_000;

const SUMMARY_Y = 9;
const FIRST_ROW_Y = 12;
const ROW_PITCH = 11;
const FOOTER_Y = BACK_DISPLAY.height - 7;

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
    text(
      'headline',
      `${counts.ready}${more} READY`,
      'front',
      'small',
      0,
      0,
      color,
    ),
    text(
      'summary',
      fitText(summary, 'tiny', FRONT_DISPLAY.width),
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      color,
    ),
    ...strip(counts),
  ];

  const stale =
    failure !== undefined && now.getTime() - latest.at.getTime() > STALE_MS;
  const footer = stale
    ? 'Linear unreachable, showing old data'
    : updated(now, latest.at);
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
    text(
      'header',
      fitText(heading(view.scope), 'small', BACK_DISPLAY.width),
      'back',
      'small',
      0,
      0,
    ),
    ...rows.flatMap(([label, count], index) => {
      const y = FIRST_ROW_Y + index * ROW_PITCH;
      return [
        text(`row-${index}-label`, label, 'back', 'small', 0, y, DIM_COLOR),
        {
          ...text(
            `row-${index}-count`,
            `${count}${more}`,
            'back',
            'small',
            BACK_DISPLAY.width - 1,
            y,
          ),
          align: 'top_right' as const,
        },
      ];
    }),
    text('footer', footer, 'back', 'tiny', 0, FOOTER_Y, DIM_COLOR),
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
      elements.push({
        id: `strip-${stage}`,
        type: 'rectangle',
        display: 'front',
        x,
        y: FRONT_DISPLAY.height - 1,
        width: end - x,
        height: 1,
        fill: 'solid',
        fill_colors: [STAGE_COLORS[stage]],
        border_width: 0,
      });
    }
    x = end;
  }
  return elements;
}

function updated(now: Date, then: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / 60_000),
  );
  return minutes === 0 ? 'updated just now' : `updated ${minutes}m ago`;
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
    lines = [
      'Cannot reach Linear:',
      failure.error instanceof Error
        ? failure.error.message
        : String(failure.error),
    ];
  }
  return [
    text('headline', 'LINEAR', 'front', 'small', 0, 0, IDLE_COLOR),
    text('summary', summary, 'front', 'tiny', 0, SUMMARY_Y, IDLE_COLOR),
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
  color: string = TEXT_COLOR,
): TextElement {
  return { id, type: 'text', display, text: content, font, color, x, y };
}
