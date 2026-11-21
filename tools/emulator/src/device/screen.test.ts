import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Animation } from '../formats/animation.ts';
import { WHITE } from '../render/canvas.ts';
import { AnimationPlayer } from './animation-player.ts';
import { ApiError } from './api-error.ts';
import type {
  AnimationElement,
  DrawRequest,
  Element,
  RectangleElement,
  TextElement,
} from './elements.ts';
import type { AnimationResolver, DrawResult, PlacedElement } from './screen.ts';
import { HOLD_MS, IDLE_PRIORITY, Screen, TIMER_PRIORITY } from './screen.ts';

// A quarter second past a whole second, so the bar's seconds clock and the
// millisecond clock disagree.
const START = 1_700_000_000_250;
const START_SECONDS = 1_700_000_000;

const COMMON = {
  display: 'front',
  x: 0,
  y: 0,
  align: 'top_left',
  zIndex: undefined,
  timeout: undefined,
  displayUntil: undefined,
} as const;

function text(id: string, fields: Partial<TextElement> = {}): TextElement {
  return {
    ...COMMON,
    id,
    type: 'text',
    text: id,
    font: 'normal',
    color: WHITE,
    width: undefined,
    scrollRate: 0,
    scrollStartDelay: 0,
    scrollRepeatDelay: 0,
    ...fields,
  };
}

function rectangle(
  id: string,
  fields: Partial<RectangleElement> = {},
): RectangleElement {
  return {
    ...COMMON,
    id,
    type: 'rectangle',
    width: 4,
    height: 2,
    radius: 0,
    fill: 'solid',
    fillColors: [WHITE, WHITE],
    borderWidth: 0,
    borderColor: WHITE,
    ...fields,
  };
}

function animation(
  id: string,
  fields: Partial<AnimationElement> = {},
): AnimationElement {
  return {
    ...COMMON,
    id,
    type: 'animation',
    source: { kind: 'stock', path: 'shared/spin.anim' },
    section: 'default',
    loop: true,
    awaitPreviousEnd: false,
    opacity: 255,
    ...fields,
  };
}

function request(
  applicationName: string,
  priority: number,
  elements: readonly Element[],
): DrawRequest {
  return { applicationName, priority, ledColor: undefined, elements };
}

/** Three 1x1 frames at 10 fps (one every 104 ms), with a "tail" section. */
const SPIN: Animation = {
  width: 1,
  height: 1,
  fps: 10,
  frames: [0, 1, 2].map((red) => ({
    width: 1,
    height: 1,
    rgba: Uint8Array.from([red, 0, 0, 255]),
  })),
  sections: new Map([['tail', { start: 1, end: 2 }]]),
};

function setup(animations?: AnimationResolver) {
  const clock = { now: START };
  const onChange = vi.fn<() => void>();
  const screen = new Screen({
    now: () => clock.now,
    onChange,
    ...(animations === undefined ? {} : { animations }),
  });
  return { screen, clock, onChange };
}

function ids(screen: Screen): string[] {
  return screen.elements().map((entry) => entry.element.id);
}

function placed(screen: Screen, id: string): PlacedElement {
  const found = screen.elements().find((entry) => entry.element.id === id);
  if (found === undefined) {
    throw new Error(`No element ${id} is on screen.`);
  }
  return found;
}

function playerOf(screen: Screen, id: string): AnimationPlayer {
  const { player } = placed(screen, id);
  if (player === undefined) {
    throw new Error(`Element ${id} has no player.`);
  }
  return player;
}

type Outcome =
  | DrawResult
  | 'pending'
  | { readonly status: number; readonly message: string };

/** Follow a draw without awaiting it, to check on it as time passes. */
function follow(drawing: Promise<DrawResult>): { outcome: Outcome } {
  const state: { outcome: Outcome } = { outcome: 'pending' };
  void drawing.then(
    (result) => {
      state.outcome = result;
    },
    (error: unknown) => {
      state.outcome =
        error instanceof ApiError
          ? { status: error.status, message: error.message }
          : { status: 0, message: 'not an ApiError' };
    },
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Screen', () => {
  describe('who may draw', () => {
    it('opens for a draw at or above the loader priority', async () => {
      const { screen, onChange } = setup();

      expect(screen.loaderPriority).toBe(IDLE_PRIORITY);
      expect(screen.owner).toBeUndefined();
      await expect(
        screen.draw(request('clock', IDLE_PRIORITY, [text('a')])),
      ).resolves.toBe('drawn');
      expect(screen.owner).toStrictEqual({
        app: 'clock',
        priority: IDLE_PRIORITY,
      });
      expect(ids(screen)).toStrictEqual(['a']);
      expect(onChange).toHaveBeenCalledOnce();
    });

    it('holds a draw below the loader priority, then answers low-priority', async () => {
      const { screen, onChange } = setup();
      const held = follow(
        screen.draw(request('clock', IDLE_PRIORITY - 1, [text('a')])),
      );

      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);

      expect(held.outcome).toBe('pending');

      await vi.advanceTimersByTimeAsync(1);

      expect(held.outcome).toBe('low-priority');
      expect(screen.owner).toBeUndefined();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('lets the owner redraw at its own priority, but not below it', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [text('a')]));

      await expect(
        screen.draw(request('clock', 50, [text('b')])),
      ).resolves.toBe('drawn');

      const lower = follow(screen.draw(request('clock', 49, [text('c')])));
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(lower.outcome).toBe('low-priority');
      expect(ids(screen)).toStrictEqual(['a', 'b']);
    });

    it('gives the canvas to another app only above the owner priority', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [text('a'), text('b')]));

      const equal = follow(screen.draw(request('news', 50, [text('n')])));
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(equal.outcome).toBe('low-priority');
      await expect(screen.draw(request('news', 51, [text('n')]))).resolves.toBe(
        'drawn',
      );
      // The new owner's draw clears what the old one drew.
      expect(screen.owner).toStrictEqual({ app: 'news', priority: 51 });
      expect(ids(screen)).toStrictEqual(['n']);
    });

    it('answers a held draw low-priority as soon as a newer one is held', async () => {
      const { screen } = setup();
      screen.setLoaderPriority(TIMER_PRIORITY);
      const older = follow(screen.draw(request('clock', 50, [text('a')])));
      await vi.advanceTimersByTimeAsync(1000);
      const newer = follow(screen.draw(request('news', 60, [text('n')])));
      await vi.advanceTimersByTimeAsync(0);

      expect(older.outcome).toBe('low-priority');
      expect(newer.outcome).toBe('pending');

      // The newer draw waits a full hold of its own.
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);

      expect(newer.outcome).toBe('pending');

      await vi.advanceTimersByTimeAsync(1);

      expect(newer.outcome).toBe('low-priority');
    });

    it('applies a held draw once the loader priority drops', async () => {
      const { screen, onChange } = setup();
      screen.setLoaderPriority(TIMER_PRIORITY);
      const held = follow(screen.draw(request('clock', 50, [text('a')])));
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
      screen.setLoaderPriority(IDLE_PRIORITY);
      await vi.advanceTimersByTimeAsync(0);

      expect(held.outcome).toBe('drawn');
      expect(screen.owner).toStrictEqual({ app: 'clock', priority: 50 });
      expect(onChange).toHaveBeenCalledOnce();

      // The hold's timer went with it.
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(held.outcome).toBe('drawn');
      expect(ids(screen)).toStrictEqual(['a']);
    });

    it('keeps holding a draw the new loader priority still refuses', async () => {
      const { screen } = setup();
      screen.setLoaderPriority(TIMER_PRIORITY);
      const held = follow(screen.draw(request('clock', 50, [text('a')])));
      screen.setLoaderPriority(60);
      await vi.advanceTimersByTimeAsync(0);

      expect(held.outcome).toBe('pending');

      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(held.outcome).toBe('low-priority');
      expect(screen.owner).toBeUndefined();
    });

    it('rejects a held draw when applying it fails', async () => {
      const { screen, clock } = setup();
      screen.setLoaderPriority(TIMER_PRIORITY);
      const held = follow(
        screen.draw(
          request('clock', 50, [
            text('a', { displayUntil: START_SECONDS + 1 }),
          ]),
        ),
      );
      // A second later on the bar's clock, the element has nothing to show.
      clock.now += 1000;
      screen.setLoaderPriority(IDLE_PRIORITY);
      await vi.advanceTimersByTimeAsync(0);

      expect(held.outcome).toStrictEqual({
        status: 400,
        message: 'Nothing to display',
      });
      expect(screen.owner).toBeUndefined();
    });

    it('closes the canvas when the loader priority rises above the owner', async () => {
      const { screen, onChange } = setup();
      await screen.draw(request('clock', 50, [text('a')]));
      screen.setLoaderPriority(50);

      expect(screen.owner).toStrictEqual({ app: 'clock', priority: 50 });
      await expect(
        screen.draw(request('clock', 50, [text('b')])),
      ).resolves.toBe('drawn');

      screen.setLoaderPriority(51);

      expect(screen.owner).toBeUndefined();
      expect(screen.elements()).toStrictEqual([]);
      expect(onChange).toHaveBeenCalledTimes(3);
    });

    it('refuses every draw while the loader holds the screen for the timer', async () => {
      const { screen } = setup();
      screen.setLoaderPriority(TIMER_PRIORITY);
      const top = follow(screen.draw(request('clock', 100, [text('a')])));
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(top.outcome).toBe('low-priority');
    });
  });

  describe('drawing', () => {
    it('refuses to open the canvas for elements that are all over', async () => {
      const { screen, onChange } = setup();

      // display_until counts whole seconds: the current one is already over.
      await expect(
        screen.draw(
          request('clock', 50, [
            text('a', { displayUntil: START_SECONDS }),
            text('b', { displayUntil: START_SECONDS - 60 }),
          ]),
        ),
      ).rejects.toThrow(new ApiError(400, 'Nothing to display'));
      expect(screen.owner).toBeUndefined();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('opens for a mix, leaving out the elements that are over', async () => {
      const { screen } = setup();
      await screen.draw(
        request('clock', 50, [
          text('a', { displayUntil: START_SECONDS }),
          text('b', { displayUntil: START_SECONDS + 1 }),
        ]),
      );

      expect(ids(screen)).toStrictEqual(['b']);
    });

    it('deletes elements redrawn with nothing left to show', async () => {
      const { screen, onChange } = setup();
      await screen.draw(request('clock', 50, [text('a'), text('b')]));
      // Once open, a draw of only finished elements is fine: it deletes them.
      await screen.draw(
        request('clock', 50, [text('a', { displayUntil: START_SECONDS })]),
      );

      expect(ids(screen)).toStrictEqual(['b']);

      await screen.draw(request('clock', 50, [text('b', { displayUntil: 1 })]));

      expect(screen.owner).toBeUndefined();
      expect(screen.elements()).toStrictEqual([]);
      expect(onChange).toHaveBeenCalledTimes(3);
    });

    it('applies elements one by one, keeping those before a bad one', async () => {
      const { screen, onChange } = setup();
      await screen.draw(request('clock', 50, [text('a')]));

      await expect(
        screen.draw(
          request('clock', 60, [text('b'), rectangle('a'), text('c')]),
        ),
      ).rejects.toThrow(new ApiError(400, 'Unspecified request error'));
      expect(ids(screen)).toStrictEqual(['a', 'b']);
      expect(placed(screen, 'a').element.type).toBe('text');
      expect(screen.owner).toStrictEqual({ app: 'clock', priority: 60 });
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('refuses moving an element to the other display', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [text('a')]));

      await expect(
        screen.draw(request('clock', 50, [text('a', { display: 'back' })])),
      ).rejects.toThrow(new ApiError(400, 'Unspecified request error'));
      expect(placed(screen, 'a').element.display).toBe('front');
    });

    it('refuses a 101st element, keeping the ones drawn before it', async () => {
      const { screen } = setup();
      const texts = (from: number, count: number): TextElement[] =>
        Array.from({ length: count }, (_, index) => text(`t${from + index}`));
      await screen.draw(request('clock', 50, texts(0, 60)));

      await expect(
        screen.draw(request('clock', 50, texts(60, 45))),
      ).rejects.toThrow(new ApiError(400, 'Elements number limit exceeded'));
      // As on the bar, the element that broke the limit stays too.
      expect(screen.elements()).toHaveLength(101);
      expect(ids(screen)).toContain('t100');
      expect(ids(screen)).not.toContain('t101');
    });

    it('stacks elements by z, defaulting to 0, 10, 20 in request order', async () => {
      const { screen } = setup();
      await screen.draw(
        request('clock', 50, [
          text('a'),
          text('b', { zIndex: 15 }),
          text('c'),
          text('d'),
          text('e', { zIndex: 10 }),
        ]),
      );

      expect(
        screen.elements().map((entry) => [entry.element.id, entry.z]),
      ).toStrictEqual([
        ['a', 0],
        ['c', 10],
        ['e', 10],
        ['b', 15],
        ['d', 20],
      ]);
    });

    it('restarts the default z with each draw, keeping first-drawn order for ties', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [text('a'), text('b')]));
      await screen.draw(request('clock', 50, [text('b'), text('a')]));

      expect(
        screen.elements().map((entry) => [entry.element.id, entry.z]),
      ).toStrictEqual([
        ['b', 0],
        ['a', 10],
      ]);

      await screen.draw(
        request('clock', 50, [
          text('b', { zIndex: 5 }),
          text('a', { zIndex: 5 }),
        ]),
      );

      expect(ids(screen)).toStrictEqual(['a', 'b']);
    });

    it('expires elements after their timeout or at their display_until second', async () => {
      const { screen } = setup();
      await screen.draw(
        request('clock', 50, [
          text('a', { timeout: 5 }),
          text('b', { displayUntil: START_SECONDS + 3 }),
          text('c'),
        ]),
      );

      expect(placed(screen, 'a').expiresAt).toBe(START + 5000);
      // Three whole seconds of the bar's clock from the draw.
      expect(placed(screen, 'b').expiresAt).toBe(START + 3000);
      expect(placed(screen, 'c').expiresAt).toBeUndefined();
    });

    it('drops the expiry of an element redrawn without one, and restamps it', async () => {
      const { screen, clock } = setup();
      await screen.draw(request('clock', 50, [text('a', { timeout: 5 })]));

      expect(placed(screen, 'a')).toMatchObject({
        expiresAt: START + 5000,
        since: START,
      });

      clock.now += 1000;
      await screen.draw(request('clock', 50, [text('a')]));

      expect(placed(screen, 'a')).toMatchObject({
        expiresAt: undefined,
        since: START + 1000,
      });
    });
  });

  describe('tick', () => {
    it('drops expired elements and closes the canvas when none remain', async () => {
      const { screen, clock, onChange } = setup();
      await screen.draw(
        request('clock', 50, [
          text('a', { timeout: 1 }),
          text('b', { timeout: 2 }),
        ]),
      );
      clock.now = START + 999;
      screen.tick();

      expect(ids(screen)).toStrictEqual(['a', 'b']);
      expect(onChange).toHaveBeenCalledOnce();

      clock.now = START + 1000;
      screen.tick();

      expect(ids(screen)).toStrictEqual(['b']);
      expect(screen.owner).toStrictEqual({ app: 'clock', priority: 50 });

      clock.now = START + 2000;
      screen.tick();

      expect(screen.owner).toBeUndefined();
      expect(onChange).toHaveBeenCalledTimes(3);
    });

    it('moves animations on', async () => {
      const { screen, clock } = setup(() => ({
        path: '/spin.anim',
        animation: SPIN,
      }));
      await screen.draw(request('clock', 50, [animation('spin')]));

      expect(playerOf(screen, 'spin').frameIndex).toBe(0);

      clock.now = START + 104;
      screen.tick();

      expect(playerOf(screen, 'spin').frameIndex).toBe(1);
    });
  });

  describe('clear', () => {
    it('leaves a closed canvas alone, refusing named elements', () => {
      const { screen, onChange } = setup();
      screen.clear(undefined, undefined);
      screen.clear('clock', undefined);

      expect(onChange).not.toHaveBeenCalled();
      expect(() => {
        screen.clear(undefined, ['a']);
      }).toThrow(new ApiError(400, 'one of element_ids is non-existent'));
      expect(() => {
        screen.clear('clock', []);
      }).toThrow(new ApiError(400, 'one of element_ids is non-existent'));
    });

    it('refuses to clear for an app that is not drawing', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [text('a')]));
      const notDrawing = new ApiError(
        400,
        'this application_name is currently not displaying anything',
      );

      expect(() => {
        screen.clear('news', undefined);
      }).toThrow(notDrawing);
      expect(() => {
        screen.clear('news', ['a']);
      }).toThrow(notDrawing);
      expect(ids(screen)).toStrictEqual(['a']);
    });

    it('closes the canvas when no elements are named', async () => {
      const { screen, onChange } = setup();
      await screen.draw(request('clock', 50, [text('a'), text('b')]));
      screen.clear('clock', undefined);

      expect(screen.owner).toBeUndefined();
      expect(screen.elements()).toStrictEqual([]);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('deletes named elements only when all of them exist', async () => {
      const { screen, onChange } = setup();
      await screen.draw(request('clock', 50, [text('a'), text('b')]));

      expect(() => {
        screen.clear(undefined, ['a', 'x']);
      }).toThrow(new ApiError(400, 'one of element_ids is non-existent'));
      expect(ids(screen)).toStrictEqual(['a', 'b']);

      screen.clear(undefined, ['a']);

      expect(ids(screen)).toStrictEqual(['b']);
      expect(screen.owner).toStrictEqual({ app: 'clock', priority: 50 });

      screen.clear('clock', ['b']);

      expect(screen.owner).toBeUndefined();
      expect(onChange).toHaveBeenCalledTimes(3);
    });
  });

  describe('close', () => {
    it('reports a close only when the canvas was open', async () => {
      const { screen, onChange } = setup();
      screen.close();

      expect(onChange).not.toHaveBeenCalled();

      await screen.draw(request('clock', 50, [text('a')]));
      screen.close();

      expect(screen.owner).toBeUndefined();
      expect(screen.elements()).toStrictEqual([]);
      expect(onChange).toHaveBeenCalledTimes(2);
    });
  });

  describe('animations', () => {
    it('gives each animation element a player for the file it resolves to', async () => {
      const resolve = vi.fn<AnimationResolver>((element) => ({
        path: `/ext/${element.source.path}`,
        animation: SPIN,
      }));
      const { screen } = setup(resolve);
      const spin = animation('spin');
      await screen.draw(request('clock', 50, [spin, text('label')]));
      const player = playerOf(screen, 'spin');

      expect(resolve).toHaveBeenCalledExactlyOnceWith(spin, 'clock');
      expect(player).toBeInstanceOf(AnimationPlayer);
      expect(player.path).toBe('/ext/shared/spin.anim');
      expect(player.animation).toBe(SPIN);
      expect(placed(screen, 'label').player).toBeUndefined();
    });

    it('keeps the player across redraws of the same file, picking the section again', async () => {
      const { screen, clock } = setup(() => ({
        path: '/spin.anim',
        animation: SPIN,
      }));
      await screen.draw(request('clock', 50, [animation('spin')]));
      const player = playerOf(screen, 'spin');
      const play = vi.spyOn(player, 'play');
      const redrawn = animation('spin', { section: 'tail', loop: false });
      await screen.draw(request('clock', 50, [redrawn]));

      expect(playerOf(screen, 'spin')).toBe(player);
      expect(play).toHaveBeenCalledExactlyOnceWith(redrawn);

      // The tail (frames 1 and 2) plays once from the next fire.
      const frames = [1, 2, 3].map((fire) => {
        clock.now = START + fire * 104;
        screen.tick();
        return player.frameIndex;
      });

      expect(frames).toStrictEqual([1, 2, 2]);
      expect(player.finished).toBe(true);
    });

    it('lets the fires due before a redraw happen first', async () => {
      const { screen, clock } = setup(() => ({
        path: '/spin.anim',
        animation: SPIN,
      }));
      await screen.draw(
        request('clock', 50, [
          animation('spin', { section: 'tail', loop: false }),
        ]),
      );
      // The tail's last frame shows at 104 ms and its timer stops at 208 ms,
      // so a redraw at 250 ms finds it stopped, even with no tick between.
      clock.now = START + 250;
      await screen.draw(request('clock', 50, [animation('spin')]));
      clock.now = START + 1000;
      screen.tick();
      const player = playerOf(screen, 'spin');

      // As on the bar, the stopped timer does not start again.
      expect(player.finished).toBe(true);
      expect(player.frameIndex).toBe(2);
    });

    it('starts a new player when a redraw names another file', async () => {
      const { screen } = setup((element) => ({
        path: `/ext/${element.source.path}`,
        animation: SPIN,
      }));
      await screen.draw(request('clock', 50, [animation('spin')]));
      const first = playerOf(screen, 'spin');
      await screen.draw(
        request('clock', 50, [
          animation('spin', { source: { kind: 'path', path: 'other.anim' } }),
        ]),
      );
      const second = playerOf(screen, 'spin');

      expect(second).not.toBe(first);
      expect(second.path).toBe('/ext/other.anim');
    });

    it('resolves an animation to its source path without a resolver', async () => {
      const { screen } = setup();
      await screen.draw(request('clock', 50, [animation('spin')]));
      const player = playerOf(screen, 'spin');

      expect(player.path).toBe('shared/spin.anim');
      expect(player.animation).toBeUndefined();
    });
  });

  it('runs on the wall clock without options', async () => {
    vi.setSystemTime(START);
    const screen = new Screen();
    await screen.draw(request('clock', 50, [text('a', { timeout: 1 })]));

    expect(placed(screen, 'a')).toMatchObject({
      since: START,
      expiresAt: START + 1000,
    });
  });
});
