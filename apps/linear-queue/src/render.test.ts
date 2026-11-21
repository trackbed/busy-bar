import { describe, expect, it } from 'vitest';

import type { BarElements, PollFailure } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  overflowingText,
} from '@busy-bar-apps/bar-kit';

import type { QueueCounts } from './linear.ts';
import { LinearError } from './linear.ts';
import type { QueueView } from './render.ts';
import {
  heading,
  READY_COLORS,
  render,
  STAGE_COLORS,
  STALE_MS,
} from './render.ts';

const NOW = new Date('2026-10-20T10:00:00Z');
const VIEW: QueueView = {
  scope: { team: 'DISC', label: undefined, mine: false },
  low: 3,
};

function counts(overrides: Partial<QueueCounts> = {}): QueueCounts {
  return {
    ready: 12,
    inProgress: 4,
    inReview: 2,
    backlog: 480,
    doneThisWeek: 19,
    capped: false,
    ...overrides,
  };
}

function draw(
  value: QueueCounts | undefined,
  { at = NOW, failure }: { at?: Date; failure?: PollFailure } = {},
): Map<string, BarElements[number]> {
  const latest = value === undefined ? undefined : { value, at };
  return new Map(
    render(NOW, latest, failure, VIEW).map((element) => [element.id, element]),
  );
}

function textOf(
  elements: Map<string, BarElements[number]>,
  id: string,
): string | undefined {
  const element = elements.get(id);
  return element !== undefined && 'text' in element ? element.text : undefined;
}

function colorOf(
  elements: Map<string, BarElements[number]>,
  id: string,
): string | undefined {
  const element = elements.get(id);
  return element !== undefined && 'color' in element
    ? element.color
    : undefined;
}

describe('render', () => {
  it('shows the ready count and what is in flight', () => {
    const elements = draw(counts());

    expect(textOf(elements, 'headline')).toBe('12 READY');
    expect(colorOf(elements, 'headline')).toBe(READY_COLORS.plenty);
    expect(textOf(elements, 'summary')).toBe('4 wip, 2 review');
  });

  it.each([
    [2, READY_COLORS.low],
    [0, READY_COLORS.empty],
  ])('warns when only %d are ready', (ready, color) => {
    const elements = draw(counts({ ready }));

    expect(colorOf(elements, 'headline')).toBe(color);
    expect(textOf(elements, 'summary')).toBe('4 wip, 2 review');
  });

  it('marks counts that hit the page limit as lower bounds', () => {
    const elements = draw(counts({ backlog: 5000, capped: true, ready: 1 }));

    expect(textOf(elements, 'headline')).toBe('1+ READY');
    expect(textOf(elements, 'summary')).toBe('4+ wip, 2+ review');
    expect(textOf(elements, 'row-4-count')).toBe('5000+');
  });

  it('splits the bottom row by stage', () => {
    const strip = [
      ...draw(counts({ ready: 2, inProgress: 1, inReview: 1 })).values(),
    ].filter((element) => element.type === 'rectangle');

    expect(strip).toMatchObject([
      { id: 'strip-ready', x: 0, width: 36, fill_colors: [STAGE_COLORS.ready] },
      { id: 'strip-inProgress', x: 36, width: 18 },
      { id: 'strip-inReview', x: 54, width: 18 },
    ]);
  });

  it('draws no strip when the queue is empty and skips empty stages', () => {
    const empty = [
      ...draw(counts({ ready: 0, inProgress: 0, inReview: 0 })).values(),
    ];
    const onlyReady = [
      ...draw(counts({ ready: 5, inProgress: 0, inReview: 0 })).values(),
    ];

    expect(empty.some((element) => element.type === 'rectangle')).toBe(false);
    expect(
      onlyReady
        .filter((element) => element.type === 'rectangle')
        .map((element) => element.id),
    ).toStrictEqual(['strip-ready']);
  });

  it('lists every stage behind', () => {
    const elements = draw(counts(), { at: new Date(NOW.getTime() - 120_000) });

    expect(textOf(elements, 'header')).toBe('DISC queue');
    expect(
      [0, 1, 2, 3, 4].map((index) => [
        textOf(elements, `row-${index}-label`),
        textOf(elements, `row-${index}-count`),
      ]),
    ).toStrictEqual([
      ['Ready (Todo)', '12'],
      ['In progress', '4'],
      ['In review', '2'],
      ['Done, last 7 days', '19'],
      ['Backlog', '480'],
    ]);
    expect(textOf(elements, 'footer')).toBe('updated 2m ago');
  });

  it('says when Linear has been unreachable for a while', () => {
    const failure = { error: new Error('offline'), at: NOW };

    expect(textOf(draw(counts(), { failure }), 'footer')).toBe(
      'updated just now',
    );
    expect(
      textOf(
        draw(counts(), { at: new Date(NOW.getTime() - STALE_MS - 1), failure }),
        'footer',
      ),
    ).toBe('Linear unreachable, showing old data');
  });

  it('keeps every text inside its display', () => {
    const elements = draw(counts({ ready: 1, backlog: 4999, capped: true }));

    expect(
      overflowingText(elements.values()).map((element) => element.id),
    ).toStrictEqual([]);
    // Other elements start inside their display too.
    const outside = [...elements.values()].filter(
      (element) =>
        (element.x ?? 0) >=
        (element.display === 'back' ? BACK_DISPLAY.width : FRONT_DISPLAY.width),
    );
    expect(outside.map((element) => element.id)).toStrictEqual([]);
  });

  it.each([
    [undefined, 'loading', 'Counting the Linear queue'],
    [
      { error: new LinearError('no', 401), at: NOW },
      'key rejected',
      'Linear rejected the request.',
    ],
    [
      { error: new LinearError('no', 400), at: NOW },
      'key rejected',
      'Linear rejected the request.',
    ],
    [
      { error: new Error('fetch failed'), at: NOW },
      'unreachable',
      'Cannot reach Linear:',
    ],
  ])('explains why there is nothing to show (%#)', (failure, summary, line) => {
    const elements = draw(undefined, failure ? { failure } : {});

    expect(textOf(elements, 'headline')).toBe('LINEAR');
    expect(textOf(elements, 'summary')).toBe(summary);
    expect(textOf(elements, 'line-0')).toBe(line);
  });
});

it('names the ready label behind when one is set', () => {
  const latest = { value: counts(), at: NOW };

  const elements = render(NOW, latest, undefined, {
    scope: { team: 'DISC', label: 'agent-ready', mine: false },
    low: 3,
  });

  expect(
    elements.find((element) => element.id === 'row-0-label'),
  ).toMatchObject({
    text: 'Ready (agent-ready)',
  });
});

describe('heading', () => {
  it('names the team and its filters', () => {
    expect(heading(VIEW.scope)).toBe('DISC queue');
    expect(heading({ team: 'DISC', label: 'agent-ready', mine: true })).toBe(
      'DISC queue: agent-ready, mine',
    );
    expect(heading({ team: 'DISC', label: undefined, mine: true })).toBe(
      'DISC queue: mine',
    );
  });
});
