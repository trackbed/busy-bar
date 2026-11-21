import { describe, expect, it } from 'vitest';

import type { BarElements, PollFailure } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  colorOf,
  elementsById,
  FRONT_DISPLAY,
  overflowingText,
  textOf,
} from '@busy-bar-apps/bar-kit';

import type { ChallengeStatus } from './challenge.ts';
import type { EventSnapshot } from './event.ts';
import type { BoothState, BoothStatus } from './photocraft.ts';
import { GALLERY_LIMIT } from './photocraft.ts';
import {
  age,
  challengeText,
  render,
  ROTATE_MS,
  rotatingLine,
  STALE_MS,
  VIEW_COLORS,
} from './render.ts';

// A multiple of ROTATE_MS, so the second line starts with the first booth.
const NOW = new Date(
  Math.floor(Date.parse('2026-10-20T10:00:00Z') / ROTATE_MS) * ROTATE_MS,
);
const QUIET_MS = 15 * 60_000;

function booth(
  boothSlug: string,
  state: BoothState,
  {
    photos = 42,
    minutesAgo = 2,
  }: { photos?: number; minutesAgo?: number | null } = {},
): BoothStatus {
  return {
    booth: { eventSlug: 'summit-2026', boothSlug },
    state,
    photos: state === 'live' ? photos : undefined,
    latestPhotoAt:
      state === 'live' && minutesAgo !== null
        ? new Date(NOW.getTime() - minutesAgo * 60_000)
        : undefined,
    problem: state === 'error' ? 'fetch failed' : undefined,
  };
}

const CHALLENGE: ChallengeStatus = {
  state: 'live',
  entries: 37,
  leader: { name: 'Anna', score: 980 },
};

function draw(
  value: EventSnapshot | undefined,
  {
    at = NOW,
    failure,
    now = NOW,
  }: { at?: Date; failure?: PollFailure; now?: Date } = {},
): Map<string, BarElements[number]> {
  const latest = value === undefined ? undefined : { value, at };
  return elementsById(render(now, latest, failure, { quietMs: QUIET_MS }));
}

function event(
  booths: BoothStatus[],
  challenge?: ChallengeStatus,
  challengeProblem?: string,
): EventSnapshot {
  return { booths, challenge, challengeProblem };
}

describe('render', () => {
  it('shows a single live booth and its portraits', () => {
    const elements = draw(event([booth('main-booth', 'live')]));

    expect(textOf(elements, 'headline')).toBe('LIVE 42');
    expect(colorOf(elements, 'headline')).toBe(VIEW_COLORS.live);
    expect(textOf(elements, 'summary')).toBe('main-booth last 2m');
  });

  it('marks a count that reached the gallery limit', () => {
    expect(
      textOf(
        draw(event([booth('main', 'live', { photos: GALLERY_LIMIT })])),
        'headline',
      ),
    ).toBe(`LIVE ${GALLERY_LIMIT}+`);
  });

  it.each([
    [booth('main', 'live', { minutesAgo: 20 }), 'QUIET 20m', VIEW_COLORS.quiet],
    [booth('main', 'off'), 'OFF', VIEW_COLORS.off],
    [booth('main', 'missing'), 'NOT FOUND', VIEW_COLORS.missing],
    [booth('main', 'error'), 'ERROR', VIEW_COLORS.error],
  ])(
    'names a single booth that is not live (%#)',
    (status, headline, color) => {
      const elements = draw(event([status]));

      expect(textOf(elements, 'headline')).toBe(headline);
      expect(colorOf(elements, 'headline')).toBe(color);
    },
  );

  it('counts live booths and their portraits across the event', () => {
    const elements = draw(
      event([
        booth('main', 'live', { photos: 40 }),
        booth('side', 'live', { photos: 2, minutesAgo: 30 }),
        booth('vip', 'off'),
      ]),
    );

    expect(textOf(elements, 'headline')).toBe('2/3 LIVE 42');
    expect(colorOf(elements, 'headline')).toBe(VIEW_COLORS.quiet);
    expect(
      [...elements.values()]
        .filter((element) => element.type === 'rectangle')
        .map((cell) => ('fill_colors' in cell ? cell.fill_colors : undefined)),
    ).toStrictEqual([
      [VIEW_COLORS.live],
      [VIEW_COLORS.quiet],
      [VIEW_COLORS.off],
    ]);
  });

  it('takes turns showing each booth and the challenge on the second line', () => {
    const snapshot = event(
      [booth('main', 'live'), booth('side', 'live', { minutesAgo: null })],
      CHALLENGE,
    );
    const turns = [0, 1, 2, 3].map((turn) =>
      textOf(
        draw(snapshot, { now: new Date(NOW.getTime() + turn * ROTATE_MS) }),
        'summary',
      ),
    );

    expect(turns).toStrictEqual([
      'main last 2m',
      'side no photos yet',
      '#1 Anna 980',
      'main last 2m',
    ]);
  });

  it('shows the challenge in front when there are no booths', () => {
    const elements = draw(event([], CHALLENGE));
    const empty = draw(
      event([], { state: 'live', entries: 0, leader: undefined }),
    );

    expect(textOf(elements, 'summary')).toBe('#1 Anna 980');
    expect(textOf(empty, 'summary')).toBe('0 entries');

    expect(textOf(elements, 'headline')).toBe('LIVE 37');
    expect(textOf(elements, 'header')).toBe('ChallengeCraft');
    expect(textOf(elements, 'challenge')).toBe(
      'Challenge: live, 37 entries, top Anna 980',
    );
    expect(
      textOf(
        draw(
          event([], { state: 'draft', entries: undefined, leader: undefined }),
        ),
        'headline',
      ),
    ).toBe('DRAFT');
    expect(
      textOf(draw(event([], undefined, 'Leaderboard not found')), 'headline'),
    ).toBe('CHALLENGE ?');
    expect(
      textOf(draw(event([], undefined, 'Leaderboard not found')), 'challenge'),
    ).toBe('Challenge: Leaderboard not found');
  });

  it('lists every booth behind', () => {
    const elements = draw(
      event([booth('main-booth', 'live'), booth('vip', 'error')], CHALLENGE),
      {
        at: new Date(NOW.getTime() - 90_000),
      },
    );

    expect(textOf(elements, 'header')).toBe('PhotoCraft: summit-2026');
    expect(
      ['name', 'status', 'photos', 'last'].map((column) =>
        textOf(elements, `row-0-${column}`),
      ),
    ).toStrictEqual(['main-booth', 'live', '42', '2m']);
    expect(
      ['name', 'status', 'photos', 'last'].map((column) =>
        textOf(elements, `row-1-${column}`),
      ),
    ).toStrictEqual(['vip', 'error', '', '']);
    expect(elements.get('challenge')).toMatchObject({ y: 32 });
    expect(textOf(elements, 'footer')).toBe('updated 1m ago');
    expect(textOf(draw(event([booth('main', 'live')])), 'footer')).toBe(
      'updated just now',
    );
  });

  it('says when Event Studio has been unreachable for a while', () => {
    const failure = { error: new Error('offline'), at: NOW };

    expect(
      textOf(
        draw(event([booth('main', 'live')]), {
          at: new Date(NOW.getTime() - STALE_MS - 1),
          failure,
        }),
        'footer',
      ),
    ).toBe('Event Studio unreachable, showing old data');
  });

  it('keeps every text inside its display', () => {
    const long = 'a-booth-slug-that-is-very-long-indeed-yes-12345';
    const elements = draw(
      event([booth(long, 'live'), booth(long, 'live')], {
        state: 'live',
        entries: 12_345,
        leader: {
          name: 'Someone With A Very Long Display Name',
          score: 123_456,
        },
      }),
    );

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
    [undefined, 'loading', 'loading'],
    [
      { error: new Error('fetch failed'), at: NOW },
      'unreachable',
      'fetch failed',
    ],
  ])(
    'explains why there is nothing to show (%#)',
    (failure, summary, header) => {
      const elements = draw(undefined, failure ? { failure } : {});

      expect(textOf(elements, 'headline')).toBe('EVENT');
      expect(textOf(elements, 'summary')).toBe(summary);
      expect(textOf(elements, 'header')).toBe(header);
    },
  );
});

describe('rotatingLine', () => {
  it('is empty without booths or a challenge', () => {
    expect(rotatingLine(event([]), [], NOW)).toBe('');
  });

  it('turns to the challenge after the booths', () => {
    const snapshot = event([booth('main', 'live')], CHALLENGE);
    const later = new Date(NOW.getTime() + ROTATE_MS);

    expect(rotatingLine(snapshot, ['live'], NOW)).toBe('main last 2m');
    expect(rotatingLine(snapshot, ['live'], later)).toBe('#1 Anna 980');
  });
});

describe('challengeText', () => {
  it('names the leaderboard, why it is unreadable, or nothing', () => {
    expect(challengeText(event([], CHALLENGE))).toBe(
      'Challenge: live, 37 entries, top Anna 980',
    );
    expect(challengeText(event([], undefined, 'Leaderboard not found'))).toBe(
      'Challenge: Leaderboard not found',
    );
    expect(challengeText(event([]))).toBeUndefined();
  });
});

describe('age', () => {
  it('rounds down to minutes, then hours', () => {
    expect(
      [0, 59, 60, 3599, 3600].map((seconds) =>
        age(new Date(NOW.getTime() + seconds * 1000), NOW),
      ),
    ).toStrictEqual(['now', 'now', '1m', '59m', '1h']);
  });
});
