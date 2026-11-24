import type { BarElements, TextElementOptions } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FOOTER_Y,
  FRONT_DISPLAY,
  PALETTE,
  fitText,
  formatAge,
  rgba,
  solidRectangle,
  textElement,
  textWidth,
  toBarText,
} from '@busy-bar-apps/bar-kit';

import type { IncomingQueue, ReviewRequest } from './incoming.ts';

const INK = rgba(0, 0, 0);
const RULE = rgba(80, 80, 80);
const PER_PAGE = 5;
const STATUS_X = 78;
const STATUS_WIDTH = 38;
const WAIT_RIGHT = BACK_DISPLAY.width - 1;
const WAIT_WIDTH = WAIT_RIGHT - STATUS_X - STATUS_WIDTH - 2;
const MAX_BADGE_COUNT = 999;

function label(
  options: Omit<TextElementOptions, 'font' | 'display'> &
    Partial<Pick<TextElementOptions, 'font' | 'display'>>,
  width?: number,
) {
  const { font = 'small', display = 'back', text, ...position } = options;
  const screenWidth =
    display === 'front' ? FRONT_DISPLAY.width : BACK_DISPLAY.width;
  return textElement({
    ...position,
    display,
    font,
    text: fitText(toBarText(text), font, width ?? screenWidth - position.x),
  });
}

function signal(
  badge: string,
  caption: string,
  headline: string,
  color: string,
): BarElements {
  const font = textWidth(badge, 'extra_large') <= 18 ? 'extra_large' : 'small';
  const width = Math.max(18, textWidth(badge, font) + 4);
  return [
    solidRectangle({
      id: 'signal',
      display: 'front',
      x: 0,
      y: 0,
      width,
      height: 16,
      color,
    }),
    textElement({
      id: 'badge',
      display: 'front',
      text: badge,
      font,
      x: Math.floor(width / 2),
      y: 8,
      align: 'center',
      color: INK,
    }),
    label({
      id: 'summary',
      text: caption,
      display: 'front',
      x: width + 3,
      y: 0,
      font: 'tiny',
      color,
    }),
    label({
      id: 'headline',
      text: headline,
      display: 'front',
      x: width + 3,
      y: 7,
      color: PALETTE.bright,
    }),
  ];
}

function header(scope: string): BarElements {
  return [
    label({ id: 'mode', text: 'INCOMING', x: 2, y: 1, color: PALETTE.bright }),
    label({
      id: 'header',
      text: scope === 'all' ? 'All repositories' : scope,
      x: 49,
      y: 3,
      font: 'tiny',
    }),
    solidRectangle({
      id: 'header-rule',
      display: 'back',
      x: 0,
      y: 11,
      width: BACK_DISPLAY.width,
      height: 1,
      color: RULE,
    }),
  ];
}

function requestRow(
  row: ReviewRequest,
  index: number,
  scope: string,
  now: Date,
  longestWait: number,
): BarElements {
  const y = 15 + index * 11;
  const hash = row.pr.lastIndexOf('#');
  const num = row.pr.slice(hash);
  const repo = row.pr.slice(0, hash);
  const name = scope === repo ? '' : repo;
  const ref =
    fitText(name, 'small', STATUS_X - 5 - textWidth(num, 'small')) + num;
  const state = row.state === 'not-ready' ? 'BLOCKED' : row.state.toUpperCase();
  const ready = row.state === 'ready';
  const wait = Math.max(0, now.getTime() - row.waiting.getTime());
  const barWidth = longestWait
    ? Math.round((wait / longestWait) * WAIT_WIDTH)
    : 0;
  return [
    label(
      { id: `row-${index}`, text: ref, x: 2, y, color: PALETTE.bright },
      STATUS_X - 5,
    ),
    ...(ready
      ? [
          solidRectangle({
            id: `ready-${index}`,
            display: 'back',
            x: STATUS_X,
            y,
            width: STATUS_WIDTH,
            height: 9,
            color: PALETTE.text,
          }),
        ]
      : []),
    label(
      {
        id: `state-${index}`,
        text: state,
        font: 'tiny',
        x: STATUS_X + 2,
        y: y + 2,
        color: ready ? INK : PALETTE.text,
      },
      STATUS_WIDTH - 3,
    ),
    ...(barWidth
      ? [
          solidRectangle({
            id: `age-bar-${index}`,
            display: 'back',
            x: WAIT_RIGHT - barWidth,
            y: y + 9,
            width: barWidth,
            height: 1,
            color: PALETTE.dim,
          }),
        ]
      : []),
    label(
      {
        id: `wait-${index}`,
        text: `${row.estimate ? '~' : ''}${formatAge(now, row.waiting)}`,
        x: WAIT_RIGHT,
        y,
        align: 'top_right',
      },
      WAIT_WIDTH,
    ),
  ];
}

export function renderIncoming(
  now: Date,
  queue: IncomingQueue | undefined,
  failed: boolean,
): BarElements {
  if (!queue) {
    return [
      ...signal('?', 'INCOMING', 'NO DATA', PALETTE.idle),
      ...header(''),
      label({
        id: 'empty',
        text: failed
          ? 'Cannot read review snapshot'
          : 'Waiting for review snapshot',
        x: 2,
        y: 32,
      }),
    ];
  }
  const { observed, requests, scope } = queue;
  const elapsed = Math.max(0, now.getTime() - observed.getTime());
  const stale = elapsed >= 15 * 60_000;
  const ready = requests.filter((row) => row.state === 'ready').length;
  const longestWait = requests.reduce(
    (longest, row) => Math.max(longest, now.getTime() - row.waiting.getTime()),
    0,
  );
  const pages = Math.max(1, Math.ceil(requests.length / PER_PAGE));
  const page = Math.floor(elapsed / 8000) % pages;
  const headline = stale ? 'STALE' : requests.length ? 'TO REVIEW' : 'CLEAR';
  const count =
    requests.length > MAX_BADGE_COUNT
      ? `${MAX_BADGE_COUNT}+`
      : String(requests.length);
  const color = stale
    ? PALETTE.warn
    : ready
      ? PALETTE.good
      : requests.length
        ? PALETTE.info
        : PALETTE.idle;
  const pageText = pages > 1 ? `${page + 1}/${pages}` : '';
  return [
    ...signal(count, `${ready} READY`, headline, color),
    ...header(scope),
    ...requests
      .slice(page * PER_PAGE, (page + 1) * PER_PAGE)
      .flatMap((row, index) => requestRow(row, index, scope, now, longestWait)),
    ...(requests.length
      ? []
      : [
          label({
            id: 'empty',
            text: 'No personal requests',
            x: 2,
            y: 32,
            font: 'normal',
          }),
        ]),
    label(
      {
        id: 'footer',
        text: `${failed ? 'Read failed / ' : ''}${stale ? 'Stale / ' : ''}checked ${formatAge(now, observed)}`,
        x: 2,
        y: FOOTER_Y,
        font: 'tiny',
        color: PALETTE.dim,
      },
      WAIT_RIGHT - 4 - textWidth(pageText, 'tiny'),
    ),
    ...(pageText
      ? [
          label(
            {
              id: 'page',
              text: pageText,
              x: WAIT_RIGHT,
              y: FOOTER_Y,
              align: 'top_right',
              font: 'tiny',
              color: PALETTE.text,
            },
            BACK_DISPLAY.width,
          ),
        ]
      : []),
  ];
}
