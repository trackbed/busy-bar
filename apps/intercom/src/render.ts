import { ConvexError } from 'convex/values';

import type {
  BarElements,
  BarFont,
  RectangleElement,
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

import type { BarStatus, Board, Focus, Knock, Status } from './board.ts';
import {
  FOCUS_ROW,
  minutesLeft,
  nameOf,
  outgoingKnock,
  runningFocus,
  screenOf,
  selectionOf,
  statusAt,
  teammates,
} from './board.ts';
import { UNKNOWN_KEY } from './convex/presence.ts';

/** What the bar knows about its team at the moment of a frame. */
export interface TeamView {
  /** The board as the deployment last sent it; undefined until it does. */
  readonly board: Board | undefined;
  /** Why the board's query failed, when there is no board to show. */
  readonly failure: Error | undefined;
  /** Whether the connection to the deployment is open. */
  readonly connected: boolean;
  /** What the wheel last pointed at. */
  readonly selected: string | undefined;
  /** How long a team focus this bar starts lasts. */
  readonly focusMinutes: number;
}

export const STATUS_COLORS: Readonly<Record<Status, string>> = {
  free: rgba(0, 200, 90),
  busy: rgba(255, 60, 60),
  resting: rgba(60, 130, 255),
  paused: rgba(255, 170, 0),
  offline: rgba(80, 80, 80),
};
export const KNOCK_COLOR = rgba(255, 170, 0);
export const FOCUS_COLOR = rgba(60, 130, 255);
const LABELS: Readonly<Record<Status, string>> = {
  free: 'FREE',
  busy: 'BUSY',
  resting: 'REST',
  paused: 'PAUSED',
  offline: 'OFFLINE',
};
const BRIGHT_COLOR = rgba(255, 255, 255);
const TEXT_COLOR = rgba(200, 200, 200);
const DIM_COLOR = rgba(120, 120, 120);
const IDLE_COLOR = rgba(110, 110, 110);

// Front: a headline in `small` (rows 0-8), a summary in `tiny` (rows 9-14),
// and one cell per teammate on the bottom row, as agent-fleet draws them.
const SUMMARY_Y = 9;
const CELL_WIDTH = 3;
const CELL_PITCH = 4;
const MAX_CELLS = Math.floor(FRONT_DISPLAY.width / CELL_PITCH);

// Back: a header, then one row per 10 px, scrolled so the highlighted one
// shows: every teammate, then the team-focus row.
const ROW_PITCH = 10;
const FIRST_ROW_Y = 11;
export const VISIBLE_ROWS = Math.floor(
  (BACK_DISPLAY.height - FIRST_ROW_Y) / ROW_PITCH,
);
const NAME_X = 6;
const COLUMN_GAP = 4;
// The knock and focus cards: what is going on, then what the buttons do.
const TITLE_Y = 14;
const DETAIL_Y = 28;
const BUTTON_Y = 36;
const MEANING_X = 40;
const FOOTER_Y = BACK_DISPLAY.height - 7;

/** A teammate, with the status that colours the front and names their row. */
interface Teammate extends BarStatus {
  readonly id: string;
  readonly name: string;
}

/** A row of the list behind. */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly dim: boolean;
}

/**
 * Who on the team is free in front, with one cell per teammate along the
 * bottom, and every teammate with their status behind, then the team-focus
 * row. A team focus counting down, or a knock waiting on this bar, takes
 * over both displays until it starts or is answered.
 */
export function render(now: Date, view: TeamView): BarElements {
  const { board } = view;
  if (board === undefined) {
    return unavailable(view.failure);
  }
  const at = now.getTime();
  const screen = screenOf(board, at);
  switch (screen.kind) {
    case 'countdown':
      return countdown(board, screen.focus, at);
    case 'knock':
      return knocking(board, screen.knock);
    case 'team':
      return teamBoard(board, at, view);
  }
}

/** The teammates in front and behind, with the team-focus row. */
function teamBoard(board: Board, at: number, view: TeamView): BarElements {
  const team: Teammate[] = teammates(board).map((bar) => ({
    id: bar.id,
    name: toBarText(bar.name),
    ...statusAt(bar, at),
  }));
  const rows: Row[] =
    team.length === 0
      ? []
      : [
          ...team.map((teammate) => ({
            id: teammate.id,
            name: teammate.name,
            label: label(teammate),
            dim: teammate.status === 'offline',
          })),
          focusRow(board, at, view.focusMinutes),
        ];
  const selection = selectionOf(board, view.selected);
  let selected: string | undefined;
  if (selection?.kind === 'teammate') {
    selected = selection.bar.id;
  } else if (selection?.kind === 'focus') {
    selected = FOCUS_ROW;
  }
  return [
    ...front(team),
    ...back(rows, selected, hint(board, team, selected, at, view)),
  ];
}

/** `BUSY 18m`, `REST 1h05`, or just `FREE`. */
export function label({ status, minutes }: BarStatus): string {
  return minutes === undefined
    ? LABELS[status]
    : `${LABELS[status]} ${duration(minutes)}`;
}

function front(team: readonly Teammate[]): BarElements {
  const free = team.filter((teammate) => teammate.status === 'free');
  let headline: string;
  let color: string;
  let summary: string;
  if (team.length === 0) {
    headline = 'NO TEAM';
    color = IDLE_COLOR;
    summary = 'run bars:add';
  } else if (free.length > 0) {
    headline = `${free.length} FREE`;
    color = STATUS_COLORS.free;
    summary = free.map((teammate) => teammate.name).join(', ');
  } else if (team.every((teammate) => teammate.status === 'offline')) {
    headline = 'ALL OFFLINE';
    color = IDLE_COLOR;
    summary = 'nobody is reporting';
  } else {
    headline = 'NONE FREE';
    color = STATUS_COLORS.busy;
    summary = nextFree(team) ?? 'nobody says when';
  }
  return [
    text('headline', headline, 'front', 'small', 0, 0, color),
    text(
      'summary',
      fitText(summary, 'tiny', FRONT_DISPLAY.width),
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      color,
    ),
    ...team.slice(0, MAX_CELLS).map((teammate, index): RectangleElement => ({
      id: `cell-${index}`,
      type: 'rectangle',
      display: 'front',
      x: index * CELL_PITCH,
      y: FRONT_DISPLAY.height - 1,
      width: CELL_WIDTH,
      height: 1,
      fill: 'solid',
      fill_colors: [STATUS_COLORS[teammate.status]],
      border_width: 0,
    })),
  ];
}

/** `Anna free in 4m`: the busy teammate whose timer ends first. */
function nextFree(team: readonly Teammate[]): string | undefined {
  let next: Teammate | undefined;
  for (const teammate of team) {
    if (
      teammate.status === 'busy' &&
      teammate.minutes !== undefined &&
      (next?.minutes === undefined || teammate.minutes < next.minutes)
    ) {
      next = teammate;
    }
  }
  return next?.minutes === undefined
    ? undefined
    : `${next.name} free in ${duration(next.minutes)}`;
}

/** The last row: start a team focus, or how the one on is going. */
function focusRow(board: Board, at: number, minutes: number): Row {
  const running = runningFocus(board, at);
  if (running !== undefined) {
    return {
      id: FOCUS_ROW,
      name: 'Team focus',
      label: `${duration(minutesLeft(running.endsAt - at))} left`,
      dim: false,
    };
  }
  const { focus } = board;
  if (focus !== null && at < focus.startsAt) {
    // A session this bar skipped.
    return {
      id: FOCUS_ROW,
      name: 'Team focus',
      label: `in ${secondsLeft(focus.startsAt - at)}s`,
      dim: true,
    };
  }
  return {
    id: FOCUS_ROW,
    name: 'Focus together',
    label: duration(minutes),
    dim: false,
  };
}

/**
 * What the header says on the right: a lost connection first, then the
 * knock this bar sent, then what OK would do.
 */
function hint(
  board: Board,
  team: readonly Teammate[],
  selected: string | undefined,
  at: number,
  view: TeamView,
): string | undefined {
  if (!view.connected) {
    return 'offline, showing old status';
  }
  const sent = outgoingKnock(board);
  if (sent !== undefined) {
    const to = nameOf(board, sent.to);
    switch (sent.status) {
      case 'waiting':
        return `knocked on ${to}`;
      case 'coming':
        return `${to} is coming`;
      case 'later':
        return `${to}: later`;
      case 'expired':
        return `${to} did not answer`;
    }
  }
  if (selected === FOCUS_ROW) {
    if (runningFocus(board, at) !== undefined) {
      return 'OK: join the team focus';
    }
    return board.focus === null
      ? `OK: focus ${duration(view.focusMinutes)} together`
      : undefined;
  }
  const teammate = team.find((candidate) => candidate.id === selected);
  return teammate?.status === 'free' ? `OK: knock ${teammate.name}` : undefined;
}

function back(
  rows: readonly Row[],
  selected: string | undefined,
  note: string | undefined,
): BarElements {
  const elements: BarElements = [
    text('header', 'Team', 'back', 'tiny', 0, 0, DIM_COLOR),
  ];
  if (note !== undefined) {
    elements.push({
      ...text(
        'hint',
        fitText(note, 'tiny', BACK_DISPLAY.width - 30),
        'back',
        'tiny',
        BACK_DISPLAY.width - 1,
        0,
        DIM_COLOR,
      ),
      align: 'top_right',
    });
  }
  window(rows, selected).forEach((row, slot) => {
    const y = FIRST_ROW_Y + slot * ROW_PITCH;
    const highlighted = row.id === selected;
    let color = TEXT_COLOR;
    if (highlighted) {
      color = BRIGHT_COLOR;
    } else if (row.dim) {
      color = DIM_COLOR;
    }
    const nameWidth =
      BACK_DISPLAY.width - NAME_X - textWidth(row.label, 'small') - COLUMN_GAP;
    if (highlighted) {
      elements.push(
        text(`row-${slot}-marker`, '>', 'back', 'small', 0, y, color),
      );
    }
    elements.push(
      text(
        `row-${slot}-name`,
        fitText(row.name, 'small', nameWidth),
        'back',
        'small',
        NAME_X,
        y,
        color,
      ),
      {
        ...text(
          `row-${slot}-status`,
          row.label,
          'back',
          'small',
          BACK_DISPLAY.width - 1,
          y,
          color,
        ),
        align: 'top_right',
      },
    );
  });
  return elements;
}

/** The rows that fit, scrolled so the highlighted one is among them. */
function window(
  rows: readonly Row[],
  selected: string | undefined,
): readonly Row[] {
  const index = Math.max(
    0,
    rows.findIndex((row) => row.id === selected),
  );
  const start = Math.max(
    0,
    Math.min(index - Math.floor(VISIBLE_ROWS / 2), rows.length - VISIBLE_ROWS),
  );
  return rows.slice(start, start + VISIBLE_ROWS);
}

/** A team focus about to start: how long, how soon, and how to skip it. */
function countdown(board: Board, focus: Focus, at: number): BarElements {
  const seconds = secondsLeft(focus.startsAt - at);
  const length = duration(Math.round((focus.endsAt - focus.startsAt) / 60_000));
  const mine = focus.startedBy === board.me;
  return [
    text(
      'headline',
      `FOCUS IN ${seconds}s`,
      'front',
      'small',
      0,
      0,
      FOCUS_COLOR,
    ),
    text(
      'summary',
      fitText(`${length} with the team`, 'tiny', FRONT_DISPLAY.width),
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      FOCUS_COLOR,
    ),
    text('header', 'Team focus', 'back', 'tiny', 0, 0, DIM_COLOR),
    text(
      'title',
      `${length} with the team`,
      'back',
      'normal',
      0,
      TITLE_Y,
      BRIGHT_COLOR,
    ),
    text('detail', `starts in ${seconds}s`, 'back', 'small', 0, DETAIL_Y),
    text('button-back', 'BACK', 'back', 'small', 0, BUTTON_Y + ROW_PITCH + 2),
    text(
      'reply-back',
      mine ? 'call it off' : 'skip it',
      'back',
      'small',
      MEANING_X,
      BUTTON_Y + ROW_PITCH + 2,
    ),
    text(
      'footer',
      fitText(
        mine
          ? 'you started it'
          : `${nameOf(board, focus.startedBy)} started it`,
        'tiny',
        BACK_DISPLAY.width,
      ),
      'back',
      'tiny',
      0,
      FOOTER_Y,
      DIM_COLOR,
    ),
  ];
}

/** A knock on this bar: who knocks, and what OK and BACK answer. */
function knocking(board: Board, knock: Knock): BarElements {
  const knocker = nameOf(board, knock.from);
  const others = board.knocks.filter(
    (other) =>
      other !== knock && other.to === board.me && other.status === 'waiting',
  ).length;
  const elements: BarElements = [
    text('headline', 'KNOCK KNOCK', 'front', 'small', 0, 0, KNOCK_COLOR),
    text(
      'summary',
      fitText(knocker, 'tiny', FRONT_DISPLAY.width),
      'front',
      'tiny',
      0,
      SUMMARY_Y,
      KNOCK_COLOR,
    ),
    text('header', 'Knock knock', 'back', 'tiny', 0, 0, DIM_COLOR),
    text(
      'knocker',
      fitText(`${knocker} is knocking`, 'normal', BACK_DISPLAY.width),
      'back',
      'normal',
      0,
      TITLE_Y,
      BRIGHT_COLOR,
    ),
    text('button-ok', 'OK', 'back', 'small', 0, BUTTON_Y, BRIGHT_COLOR),
    text('reply-ok', 'coming', 'back', 'small', MEANING_X, BUTTON_Y),
    text('button-back', 'BACK', 'back', 'small', 0, BUTTON_Y + ROW_PITCH + 2),
    text(
      'reply-back',
      'later',
      'back',
      'small',
      MEANING_X,
      BUTTON_Y + ROW_PITCH + 2,
    ),
  ];
  if (others > 0) {
    elements.push(
      text(
        'more',
        `+${others} more knocking`,
        'back',
        'tiny',
        0,
        FOOTER_Y,
        DIM_COLOR,
      ),
    );
  }
  return elements;
}

function unavailable(failure: Error | undefined): BarElements {
  let summary: string;
  let lines: readonly string[];
  if (failure === undefined) {
    summary = 'connecting';
    lines = ['Connecting to the team'];
  } else if (failure instanceof ConvexError && failure.data === UNKNOWN_KEY) {
    summary = 'unknown key';
    lines = [
      'The team does not know this',
      "bar's INTERCOM_KEY. Ask the",
      'deployment owner for one.',
    ];
  } else {
    summary = 'cannot load the team';
    lines = ['Cannot load the team:', failure.message];
  }
  return [
    text('headline', 'INTERCOM', 'front', 'small', 0, 0, IDLE_COLOR),
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

function secondsLeft(ms: number): number {
  return Math.ceil(ms / 1000);
}

function duration(minutes: number): string {
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
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
