import { describe, expect, it, vi } from 'vitest';

import { focusFrom } from './__tests__/fixtures.ts';
import type { Board, Knock } from './board.ts';
import type { ChimeOptions } from './chime.ts';
import { createChime } from './chime.ts';

const NOW = Date.parse('2026-10-27T09:00:00Z');

function board(...knocks: Knock[]): Board {
  return { me: 'Me', bars: [], knocks, focus: null };
}

const FOCUS = focusFrom(NOW + 15_000);

function setup() {
  const play = vi.fn<ChimeOptions['play']>();
  return { play, chime: createChime({ play, now: () => NOW }) };
}

const knockOnMe: Knock = {
  id: 'in',
  from: 'Anna',
  to: 'Me',
  status: 'waiting',
};

describe('createChime', () => {
  it('rings once for each new knock on this bar', () => {
    const { chime, play } = setup();

    chime.observe(board(knockOnMe));
    chime.observe(board(knockOnMe));
    chime.observe(board(knockOnMe, { ...knockOnMe, id: 'in2' }));

    expect(play.mock.calls).toStrictEqual([['event']]);
  });

  it('rings once for each answer to the knock this bar sent', () => {
    const { chime, play } = setup();
    const mine: Knock = { id: 'out', from: 'Me', to: 'Ben', status: 'waiting' };

    chime.observe(board(mine));
    chime.observe(board({ ...mine, status: 'later' }));
    chime.observe(board({ ...mine, status: 'later' }));
    chime.observe(board());
    chime.observe(board({ ...mine, id: 'out2', status: 'expired' }));

    expect(play.mock.calls).toStrictEqual([['reminder'], ['reminder']]);
  });

  it('forgets the knocks a board stops showing', () => {
    const { chime, play } = setup();

    chime.observe(board(knockOnMe));
    chime.observe(board());
    chime.observe(board(knockOnMe));

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('stays quiet while the board is lost, and for what it heard before', () => {
    const { chime, play } = setup();

    chime.observe(board(knockOnMe));
    chime.observe(undefined);
    chime.observe(board(knockOnMe));

    expect(play.mock.calls).toStrictEqual([['event']]);
  });

  it('rings once as a team focus starts to count down, before a knock', () => {
    const { chime, play } = setup();
    const both = { ...board(knockOnMe), focus: FOCUS };

    chime.observe(both);
    chime.observe(both);
    chime.observe(board(knockOnMe));

    expect(play.mock.calls).toStrictEqual([['event'], ['event']]);
  });

  it('stays quiet for a team focus already running or skipped', () => {
    const { chime, play } = setup();

    chime.observe({ ...board(), focus: { ...FOCUS, startsAt: NOW } });
    chime.observe({ ...board(), focus: { ...FOCUS, skipped: ['Me'] } });

    expect(play).not.toHaveBeenCalled();
  });
});
