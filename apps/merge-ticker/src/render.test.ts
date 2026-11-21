import { describe, expect, it } from 'vitest';

import type { BarElements, PollFailure } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  overflowingText,
} from '@busy-bar-apps/bar-kit';

import type { OpenPullRequest, PullRequests } from './github.ts';
import { GitHubError } from './github.ts';
import {
  CELEBRATION_MS,
  CHECK_COLORS,
  MAX_CELLS,
  MERGED_COLOR,
  QUEUED_COLOR,
  reference,
  render,
  STALE_MS,
} from './render.ts';
import type { Celebration, TickerState } from './watch.ts';

const NOW = new Date('2026-10-20T10:00:00Z');

function pull(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    repo: 'Abildtoft/discera',
    number: 12,
    title: 'Add merge ticker',
    draft: false,
    autoMerge: false,
    checks: 'passing',
    ...overrides,
  };
}

function state(
  open: OpenPullRequest[],
  {
    mergedToday = 3,
    celebration,
  }: { mergedToday?: number; celebration?: Celebration } = {},
): TickerState {
  const pulls: PullRequests = {
    open,
    openCount: open.length,
    mergedToday,
    merged: [],
  };
  return { pulls, celebration };
}

function draw(
  value: TickerState | undefined,
  { at = NOW, failure }: { at?: Date; failure?: PollFailure } = {},
): Map<string, BarElements[number]> {
  const latest = value === undefined ? undefined : { value, at };
  return new Map(
    render(NOW, latest, failure).map((element) => [element.id, element]),
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
  it('shows the merge count beside the open pull requests', () => {
    const elements = draw(
      state([pull(), pull({ number: 13, checks: 'pending' })]),
    );

    expect(textOf(elements, 'count')).toBe('3');
    expect(colorOf(elements, 'count')).toBe(MERGED_COLOR);
    expect(textOf(elements, 'headline')).toBe('2 OPEN');
    expect(textOf(elements, 'focus')).toBe('discera#12');
    expect(textOf(elements, 'header')).toBe('3 merged today, 2 open');
  });

  it('puts failing checks first', () => {
    const elements = draw(
      state([
        pull({ autoMerge: true }),
        pull({ number: 7, checks: 'failing' }),
      ]),
    );

    expect(textOf(elements, 'headline')).toBe('1 FAILING');
    expect(colorOf(elements, 'headline')).toBe(CHECK_COLORS.failing);
    expect(textOf(elements, 'focus')).toBe('discera#7');
  });

  it('then the auto-merge queue', () => {
    const elements = draw(
      state([pull(), pull({ number: 9, autoMerge: true })]),
    );

    expect(textOf(elements, 'headline')).toBe('1 QUEUED');
    expect(colorOf(elements, 'headline')).toBe(QUEUED_COLOR);
    expect(textOf(elements, 'focus')).toBe('discera#9');
  });

  it('says when nothing is open and nothing merged', () => {
    const elements = draw(state([], { mergedToday: 0 }));

    expect(textOf(elements, 'headline')).toBe('NONE OPEN');
    expect(textOf(elements, 'focus')).toBe('merged today');
    expect(colorOf(elements, 'count')).not.toBe(MERGED_COLOR);
  });

  it('celebrates a new merge for a few seconds', () => {
    const celebration: Celebration = {
      merge: {
        repo: 'Abildtoft/discera',
        number: 42,
        title: 'Ship it',
        mergedAt: NOW,
      },
      noticedAt: new Date(NOW.getTime() - CELEBRATION_MS + 1),
    };

    const during = draw(state([pull()], { celebration }));
    const after = draw(
      state([pull()], {
        celebration: {
          ...celebration,
          noticedAt: new Date(NOW.getTime() - CELEBRATION_MS),
        },
      }),
    );

    expect(textOf(during, 'headline')).toBe('MERGED!');
    expect(textOf(during, 'focus')).toBe('discera#42');
    expect(textOf(during, 'header')).toBe('Merged discera#42!');
    expect(textOf(after, 'headline')).toBe('1 OPEN');
  });

  it('draws one cell per open pull request, coloured by its checks', () => {
    const open = [
      pull({ checks: 'failing' }),
      pull({ checks: 'pending', draft: true }),
      ...Array.from({ length: MAX_CELLS + 2 }, (_, index) =>
        pull({ number: index }),
      ),
    ];

    const cells = [...draw(state(open)).values()].filter(
      (element) => element.type === 'rectangle',
    );

    expect(cells).toHaveLength(MAX_CELLS);
    expect(cells[0]).toMatchObject({
      fill_colors: [CHECK_COLORS.failing],
      y: 15,
    });
    expect(cells.at(-1)).toMatchObject({ x: FRONT_DISPLAY.width - 4 });
  });

  it('lists open pull requests behind with a tag for each', () => {
    const elements = draw(
      state([
        pull({ checks: 'failing' }),
        pull({ autoMerge: true }),
        pull({ draft: true, checks: 'none' }),
        pull({ checks: 'pending' }),
        pull({ checks: 'none' }),
        pull(),
      ]),
    );

    expect(
      [0, 1, 2, 3, 4, 5].map((index) => textOf(elements, `row-${index}-tag`)),
    ).toStrictEqual(['FAIL', 'auto', 'draft', 'wait', '-', 'ok']);
    expect(textOf(elements, 'row-0-title')).toBe('Add merge ticker');
    expect(textOf(elements, 'footer')).toBe('updated just now');
  });

  it('keeps every text inside its display and every number visible', () => {
    const long = pull({
      repo: 'consensusaps/a-repository-with-a-very-long-name',
      number: 12345,
      title:
        'A pull request title that is far too long to fit on the back display',
      checks: 'failing',
    });

    const elements = draw(state([long], { mergedToday: 128 }));

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
    expect(textOf(elements, 'focus')).toMatch(/^a-rep.*\.\.#12345$/);
    expect(textOf(elements, 'row-0-ref')).toMatch(/\.\.#12345$/);
  });

  it('says when GitHub has been unreachable for a while', () => {
    const failure = { error: new Error('offline'), at: NOW };

    const recent = draw(state([]), {
      at: new Date(NOW.getTime() - 60_000),
      failure,
    });
    const old = draw(state([]), {
      at: new Date(NOW.getTime() - STALE_MS - 1),
      failure,
    });

    expect(textOf(recent, 'footer')).toBe('updated 1m ago');
    expect(textOf(old, 'footer')).toBe('GitHub unreachable, showing old data');
  });

  it.each([
    [undefined, 'loading', 'Asking GitHub for your pull requests'],
    [
      { error: new GitHubError('no', 401), at: NOW },
      'token rejected',
      'GitHub rejected GITHUB_TOKEN.',
    ],
    [
      { error: new Error('fetch failed'), at: NOW },
      'unreachable',
      'Cannot reach GitHub:',
    ],
  ])('explains why there is nothing to show (%#)', (failure, summary, line) => {
    const elements = draw(undefined, failure ? { failure } : {});

    expect(textOf(elements, 'headline')).toBe('GITHUB');
    expect(textOf(elements, 'summary')).toBe(summary);
    expect(textOf(elements, 'line-0')).toBe(line);
  });
});

describe('reference', () => {
  it('drops the owner', () => {
    expect(reference({ repo: 'Abildtoft/discera', number: 3 })).toBe(
      'discera#3',
    );
    expect(reference({ repo: 'no-owner', number: 1 })).toBe('no-owner#1');
  });
});
