import { describe, expect, it } from 'vitest';

import type { BarElements } from '@busy-bar-apps/bar-kit';
import { colorOf, elementsById, SetupError } from '@busy-bar-apps/bar-kit';

import { bar, focusFrom } from './__tests__/fixtures.ts';
import type { Board, Focus, Knock, TeamBar } from './board.ts';
import { FOCUS_ROW } from './board.ts';
import type { TeamView } from './render.ts';
import {
  FOCUS_COLOR,
  KNOCK_COLOR,
  label,
  render,
  STATUS_COLORS,
  VISIBLE_ROWS,
} from './render.ts';

const NOW = new Date('2026-10-26T13:00:00Z');
const MINUTE = 60_000;
const at = (minutes: number): number => NOW.getTime() + minutes * MINUTE;

const ME = bar('Me', { state: 'free' });

function view(
  teammates: readonly TeamBar[],
  fields: Partial<Omit<TeamView, 'board'>> & {
    readonly knocks?: readonly Knock[];
    readonly focus?: Focus;
  } = {},
): TeamView {
  const { knocks = [], focus = null, ...rest } = fields;
  const board: Board = { me: ME.id, bars: [ME, ...teammates], knocks, focus };
  return {
    board,
    failure: undefined,
    connected: true,
    selected: undefined,
    focusMinutes: 25,
    ...rest,
  };
}

function texts(elements: BarElements): Record<string, string> {
  return Object.fromEntries(
    elements.flatMap((element) =>
      element.type === 'text' ? [[element.id, element.text]] : [],
    ),
  );
}

function cells(elements: BarElements): (string | undefined)[] {
  return elements.flatMap((element) =>
    element.type === 'rectangle' ? [element.fill_colors?.[0]] : [],
  );
}

describe('label', () => {
  it('shows minutes, then hours', () => {
    expect(label({ status: 'free', minutes: undefined })).toBe('FREE');
    expect(label({ status: 'busy', minutes: 59 })).toBe('BUSY 59m');
    expect(label({ status: 'resting', minutes: 65 })).toBe('REST 1h05');
    expect(label({ status: 'paused', minutes: 120 })).toBe('PAUSED 2h00');
  });
});

describe('render', () => {
  it('counts and names the free teammates, leaving this bar out', () => {
    const elements = render(
      NOW,
      view([
        bar('Anna', { state: 'busy', endsAt: at(18) }),
        bar('Ben', { state: 'free' }),
        bar('Cleo', { state: 'free' }),
      ]),
    );

    expect(texts(elements)).toMatchObject({
      headline: '2 FREE',
      summary: 'Ben, Cleo',
    });
    expect(colorOf(elementsById(elements), 'headline')).toBe(
      STATUS_COLORS.free,
    );
    expect(cells(elements)).toStrictEqual([
      STATUS_COLORS.busy,
      STATUS_COLORS.free,
      STATUS_COLORS.free,
    ]);
  });

  it('names whose timer ends first when nobody is free', () => {
    expect(
      texts(
        render(
          NOW,
          view([
            bar('Anna', { state: 'busy', endsAt: at(18) }),
            bar('Ben', { state: 'busy', endsAt: at(7) }),
            bar('Cleo', { state: 'resting', endsAt: at(2) }),
            bar('Dan', { state: 'busy', endsAt: null }),
          ]),
        ),
      ),
    ).toMatchObject({ headline: 'NONE FREE', summary: 'Ben free in 7m' });
  });

  it('says when nobody busy has an end', () => {
    expect(
      texts(
        render(
          NOW,
          view([
            bar('Anna', { state: 'busy', endsAt: null }),
            bar('Ben', { state: 'paused', leftMs: MINUTE }),
          ]),
        ),
      ),
    ).toMatchObject({ headline: 'NONE FREE', summary: 'nobody says when' });
  });

  it('tells an offline team from a busy one', () => {
    expect(
      texts(render(NOW, view([bar('Anna', { state: 'free' }, false)]))),
    ).toMatchObject({
      headline: 'ALL OFFLINE',
      summary: 'nobody is reporting',
    });
  });

  it('explains a team of one', () => {
    expect(texts(render(NOW, view([])))).toStrictEqual({
      headline: 'NO TEAM',
      summary: 'run bars:add',
      header: 'Team',
    });
  });

  it('lists the teammates behind and marks the one the wheel points at', () => {
    const elements = render(
      NOW,
      view(
        [
          bar('Anna', { state: 'busy', endsAt: at(18) }),
          bar('Ben', { state: 'free' }),
          bar('Bob', { state: 'free' }, false),
        ],
        { selected: 'Ben' },
      ),
    );

    expect(texts(elements)).toStrictEqual({
      headline: '1 FREE',
      summary: 'Ben',
      header: 'Team',
      hint: 'OK: knock Ben',
      'row-0-name': 'Anna',
      'row-0-status': 'BUSY 18m',
      'row-1-marker': '>',
      'row-1-name': 'Ben',
      'row-1-status': 'FREE',
      'row-2-name': 'Bob',
      'row-2-status': 'OFFLINE',
      'row-3-name': 'Focus together',
      'row-3-status': '25m',
    });
    expect(colorOf(elementsById(elements), 'row-1-name')).not.toBe(
      colorOf(elementsById(elements), 'row-0-name'),
    );
    expect(colorOf(elementsById(elements), 'row-2-name')).not.toBe(
      colorOf(elementsById(elements), 'row-0-name'),
    );
  });

  it('points at the first teammate and offers no knock to a busy one', () => {
    const shown = texts(
      render(NOW, view([bar('Anna', { state: 'busy', endsAt: at(3) })])),
    );

    expect(shown['row-0-marker']).toBe('>');
    expect(shown['hint']).toBeUndefined();
  });

  it('cuts long names to fit beside the status', () => {
    const shown = texts(
      render(
        NOW,
        view([
          bar('WWWWWWWWWWWWWWWW', { state: 'paused', leftMs: 125 * MINUTE }),
        ]),
      ),
    );

    expect(shown['row-0-status']).toBe('PAUSED 2h05');
    expect(shown['row-0-name']).toMatch(/\.\.$/u);
  });

  it('scrolls the list so the highlighted teammate shows', () => {
    const team = Array.from({ length: VISIBLE_ROWS + 4 }, (_, index) =>
      bar(`Bar ${String(index).padStart(2, '0')}`, { state: 'free' }),
    );
    const last = team.at(-1)?.id;

    const top = texts(render(NOW, view(team)));
    const bottom = texts(render(NOW, view(team, { selected: last })));

    expect(top['row-0-name']).toBe('Bar 00');
    expect(top[`row-${VISIBLE_ROWS}-name`]).toBeUndefined();
    // The focus row follows the last teammate.
    expect(bottom[`row-${VISIBLE_ROWS - 2}-name`]).toBe(last);
    expect(bottom[`row-${VISIBLE_ROWS - 2}-marker`]).toBe('>');
    expect(bottom[`row-${VISIBLE_ROWS - 1}-name`]).toBe('Focus together');
  });

  it('draws at most one cell per four columns', () => {
    const team = Array.from({ length: 19 }, (_, index) =>
      bar(`Bar ${index}`, { state: 'free' }),
    );

    expect(cells(render(NOW, view(team)))).toHaveLength(18);
  });

  it.each([
    ['waiting', 'knocked on Ben'],
    ['coming', 'Ben is coming'],
    ['later', 'Ben: later'],
    ['expired', 'Ben did not answer'],
  ] as const)('tells the knock it sent is %s', (status, hint) => {
    const knocks: Knock[] = [{ id: 'k', from: 'Me', to: 'Ben', status }];

    expect(
      texts(render(NOW, view([bar('Ben', { state: 'free' })], { knocks })))[
        'hint'
      ],
    ).toBe(hint);
  });

  it('says first when it lost the deployment', () => {
    const knocks: Knock[] = [
      { id: 'k', from: 'Me', to: 'Anna', status: 'coming' },
    ];

    expect(
      texts(
        render(
          NOW,
          view([bar('Anna', { state: 'free' })], { connected: false, knocks }),
        ),
      )['hint'],
    ).toBe('offline, showing old status');
  });

  describe('a knock on this bar', () => {
    const team = [
      bar('Anna', { state: 'free' }),
      bar('Ben', { state: 'free' }),
    ];

    it('takes over both displays with what each button answers', () => {
      const elements = render(
        NOW,
        view(team, {
          knocks: [{ id: 'k', from: 'Anna', to: 'Me', status: 'waiting' }],
        }),
      );

      expect(texts(elements)).toStrictEqual({
        headline: 'KNOCK KNOCK',
        summary: 'Anna',
        header: 'Knock knock',
        knocker: 'Anna is knocking',
        'button-ok': 'OK',
        'reply-ok': 'coming',
        'button-back': 'BACK',
        'reply-back': 'later',
      });
      expect(colorOf(elementsById(elements), 'headline')).toBe(KNOCK_COLOR);
      expect(cells(elements)).toStrictEqual([]);
    });

    it('counts the other knocks waiting behind it', () => {
      expect(
        texts(
          render(
            NOW,
            view(team, {
              knocks: [
                { id: 'k1', from: 'Anna', to: 'Me', status: 'waiting' },
                { id: 'k2', from: 'Ben', to: 'Me', status: 'waiting' },
              ],
            }),
          ),
        ),
      ).toMatchObject({
        knocker: 'Anna is knocking',
        more: '+1 more knocking',
      });
    });
  });

  describe('before the first board', () => {
    const empty = (failure: Error | undefined): TeamView => ({
      board: undefined,
      failure,
      connected: false,
      selected: undefined,
      focusMinutes: 25,
    });

    it('says it is connecting', () => {
      expect(texts(render(NOW, empty(undefined)))).toStrictEqual({
        headline: 'INTERCOM',
        summary: 'connecting',
        'line-0': 'Connecting to the team',
      });
    });

    it('says what to fix for a setup error', () => {
      expect(
        texts(
          render(NOW, empty(new SetupError('unknown key', ['Ask for a key.']))),
        ),
      ).toMatchObject({ summary: 'unknown key', 'line-0': 'Ask for a key.' });
    });

    it('shows any other failure', () => {
      expect(
        texts(render(NOW, empty(new Error('Server error')))),
      ).toMatchObject({
        summary: 'cannot load the team',
        'line-1': 'Server error',
      });
    });
  });

  describe('team focus', () => {
    const team = [bar('Anna', { state: 'free' })];
    const focus = focusFrom(at(0) + 9000);
    const row = (shown: Record<string, string>) => [
      shown['row-1-name'],
      shown['row-1-status'],
    ];

    it('offers to start one from the last row', () => {
      const shown = texts(
        render(NOW, view(team, { selected: FOCUS_ROW, focusMinutes: 90 })),
      );

      expect(row(shown)).toStrictEqual(['Focus together', '1h30']);
      expect(shown['row-1-marker']).toBe('>');
      expect(shown['hint']).toBe('OK: focus 1h30 together');
    });

    it('counts down on every bar that has not skipped it', () => {
      const elements = render(NOW, view(team, { focus }));

      expect(texts(elements)).toStrictEqual({
        headline: 'FOCUS IN 9s',
        summary: '25m with the team',
        header: 'Team focus',
        title: '25m with the team',
        detail: 'starts in 9s',
        'button-back': 'BACK',
        'reply-back': 'skip it',
        footer: 'Anna started it',
      });
      expect(colorOf(elementsById(elements), 'headline')).toBe(FOCUS_COLOR);
    });

    it('lets the bar that started it call it off, before a knock shows', () => {
      const shown = texts(
        render(
          NOW,
          view(team, {
            focus: { ...focus, startedBy: ME.id },
            knocks: [{ id: 'k', from: 'Anna', to: 'Me', status: 'waiting' }],
          }),
        ),
      );

      expect(shown).toMatchObject({
        'reply-back': 'call it off',
        footer: 'you started it',
      });
    });

    it('shows a skipped session on the last row, with nothing to press', () => {
      const shown = texts(
        render(
          NOW,
          view(team, {
            focus: { ...focus, skipped: [ME.id] },
            selected: FOCUS_ROW,
          }),
        ),
      );

      expect(row(shown)).toStrictEqual(['Team focus', 'in 9s']);
      expect(shown['hint']).toBeUndefined();
    });

    it('offers to join a running session', () => {
      const shown = texts(
        render(
          new Date(focus.startsAt + MINUTE),
          view(team, { focus, selected: FOCUS_ROW }),
        ),
      );

      expect(row(shown)).toStrictEqual(['Team focus', '24m left']);
      expect(shown['hint']).toBe('OK: join the team focus');
    });

    it('offers nothing for a session that has ended but not been dropped', () => {
      const shown = texts(
        render(
          new Date(focus.endsAt),
          view(team, { focus, selected: FOCUS_ROW }),
        ),
      );

      expect(row(shown)).toStrictEqual(['Focus together', '25m']);
      expect(shown['hint']).toBeUndefined();
    });
  });
});
