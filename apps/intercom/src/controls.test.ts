import { describe, expect, it, vi } from 'vitest';

import type { InputEvent } from '@busy-bar-apps/bar-kit';

import type { Board, Focus, Knock, TeamBar } from './board.ts';
import { FOCUS_ROW } from './board.ts';
import type { ControlsOptions } from './controls.ts';
import { createControls } from './controls.ts';
import type { Presence } from './convex/presence.ts';

const NOW = Date.parse('2026-10-26T13:00:00Z');
const MINUTE = 60_000;

function bar(name: string, presence: Presence = { state: 'free' }): TeamBar {
  return { id: name, name, online: true, presence };
}

const TEAM = [
  bar('Anna'),
  bar('Ben', { state: 'busy', endsAt: NOW + MINUTE }),
  bar('Me'),
  bar('Cleo'),
];

const FOCUS: Focus = {
  id: 'f',
  startedBy: 'Anna',
  startsAt: NOW + 10_000,
  endsAt: NOW + 10_000 + 25 * MINUTE,
  cardId: '00000000-0000-4000-8000-000000000000',
  skipped: [],
};

function setup(
  options: {
    knocks?: readonly Knock[];
    focus?: Focus | null;
    onScreen?: boolean;
    now?: number;
  } = {},
) {
  const shown: { board: Board | undefined; onScreen: boolean } = {
    board: {
      me: 'Me',
      bars: TEAM,
      knocks: options.knocks ?? [],
      focus: options.focus ?? null,
    },
    onScreen: options.onScreen ?? true,
  };
  const calls = {
    knock: vi.fn<ControlsOptions['knock']>(() => Promise.resolve()),
    answer: vi.fn<ControlsOptions['answer']>(() => Promise.resolve()),
    startFocus: vi.fn<ControlsOptions['startFocus']>(() => Promise.resolve()),
    skipFocus: vi.fn<ControlsOptions['skipFocus']>(() => Promise.resolve()),
    joinFocus: vi.fn<ControlsOptions['joinFocus']>(() => Promise.resolve()),
  };
  const log = { warn: vi.fn<Console['warn']>() };
  const controls = createControls({
    name: 'test',
    board: () => shown.board,
    onScreen: () => shown.onScreen,
    ...calls,
    now: () => options.now ?? NOW,
    log,
  });
  return { shown, calls, log, controls };
}

const wheel = (delta: number): InputEvent => ({ kind: 'wheel', delta });
const press = (button: 'ok' | 'back' | 'start'): InputEvent => ({
  kind: 'button',
  button,
  action: 'press',
});

describe('createControls', () => {
  it('moves the highlight over the teammates and the focus row, stopping at the ends', () => {
    const { controls } = setup();

    controls.handle(wheel(1));
    expect(controls.selected()).toBe('Ben');

    controls.handle(wheel(5));
    expect(controls.selected()).toBe(FOCUS_ROW);

    controls.handle(wheel(-1));
    expect(controls.selected()).toBe('Cleo');

    controls.handle(wheel(-9));
    expect(controls.selected()).toBe('Anna');
  });

  it('knocks on the highlighted teammate when they are free', () => {
    const { controls, calls } = setup();

    controls.handle(press('ok'));
    controls.handle(wheel(1));
    controls.handle(press('ok'));
    controls.handle({ kind: 'button', button: 'ok', action: 'release' });

    expect(calls.knock.mock.calls).toStrictEqual([['Anna']]);
  });

  it('answers a knock on this bar with OK or BACK', () => {
    const knocks: Knock[] = [
      { id: 'k', from: 'Anna', to: 'Me', status: 'waiting' },
    ];
    const { controls, calls } = setup({ knocks });

    controls.handle(press('start'));
    controls.handle(wheel(1));
    controls.handle(press('ok'));
    controls.handle(press('back'));

    expect(calls.answer.mock.calls).toStrictEqual([
      ['k', 'coming'],
      ['k', 'later'],
    ]);
    expect(calls.knock).not.toHaveBeenCalled();
    expect(controls.selected()).toBeUndefined();
  });

  describe('team focus', () => {
    it('starts one from the focus row', () => {
      const { controls, calls } = setup();

      controls.handle(wheel(9));
      controls.handle(press('ok'));

      expect(calls.startFocus).toHaveBeenCalledOnce();
      expect(calls.knock).not.toHaveBeenCalled();
    });

    it('skips a session counting down with BACK, before a knock', () => {
      const knocks: Knock[] = [
        { id: 'k', from: 'Anna', to: 'Me', status: 'waiting' },
      ];
      const { controls, calls } = setup({ knocks, focus: FOCUS });

      controls.handle(press('ok'));
      controls.handle(wheel(1));
      controls.handle(press('back'));

      expect(calls.skipFocus.mock.calls).toStrictEqual([['f']]);
      expect(calls.answer).not.toHaveBeenCalled();
      expect(controls.selected()).toBeUndefined();
    });

    it('joins a running session from the focus row', () => {
      const { controls, calls } = setup({
        focus: FOCUS,
        now: FOCUS.startsAt + MINUTE,
      });

      controls.handle(wheel(9));
      controls.handle(press('ok'));

      expect(calls.joinFocus.mock.calls).toStrictEqual([[FOCUS]]);
      expect(calls.startFocus).not.toHaveBeenCalled();
    });

    it('does nothing on the focus row while a skipped session counts down', () => {
      const { controls, calls } = setup({
        focus: { ...FOCUS, skipped: ['Me'] },
      });

      controls.handle(wheel(9));
      controls.handle(press('ok'));

      expect(calls.startFocus).not.toHaveBeenCalled();
      expect(calls.joinFocus).not.toHaveBeenCalled();
    });
  });

  it('ignores input while the app is off screen or has no board', () => {
    const { controls, calls, shown } = setup({ onScreen: false });

    controls.handle(wheel(1));
    controls.handle(press('ok'));
    shown.onScreen = true;
    shown.board = undefined;
    controls.handle(press('ok'));

    expect(controls.selected()).toBeUndefined();
    expect(calls.knock).not.toHaveBeenCalled();
  });

  it('logs a request that fails', async () => {
    const { controls, calls, log } = setup();
    calls.knock.mockRejectedValueOnce(
      new Error('Anna cannot take a knock now.'),
    );

    controls.handle(press('ok'));
    await vi.waitFor(() => {
      expect(log.warn).toHaveBeenCalledExactlyOnceWith(
        '[test] Knocking on Anna failed:',
        new Error('Anna cannot take a knock now.'),
      );
    });
  });

  it('does nothing on a team of one', () => {
    const { controls, calls, shown } = setup();
    shown.board = { me: 'Me', bars: [bar('Me')], knocks: [], focus: null };

    controls.handle(wheel(1));
    controls.handle(press('ok'));

    expect(controls.selected()).toBeUndefined();
    expect(calls.knock).not.toHaveBeenCalled();
    expect(calls.startFocus).not.toHaveBeenCalled();
  });
});
