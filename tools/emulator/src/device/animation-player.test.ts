import { describe, expect, it } from 'vitest';

import type { Animation, Section } from '../formats/animation.ts';
import type { Bitmap } from '../formats/png.ts';
import type { PlayRequest } from './animation-player.ts';
import { AnimationPlayer } from './animation-player.ts';

const T0 = 1_000_000;
// 10 fps: floor(1000 / 10) = 100 ms, rounded up to whole 8 ms GUI ticks.
const PERIOD = 104;

/** A 1x1 frame whose red channel holds its index. */
function frame(index: number): Bitmap {
  return { width: 1, height: 1, rgba: Uint8Array.from([index, 0, 0, 255]) };
}

function film(
  count: number,
  sections: Readonly<Record<string, Section>> = {},
  fps = 10,
): Animation {
  return {
    width: 1,
    height: 1,
    fps,
    frames: Array.from({ length: count }, (_, index) => frame(index)),
    sections: new Map(Object.entries(sections)),
  };
}

function request(
  section = 'default',
  fields: Partial<PlayRequest> = {},
): PlayRequest {
  return { section, loop: true, awaitPreviousEnd: false, ...fields };
}

/** The frame on screen after each of `count` timer fires from fire `first`. */
function fires(
  player: AnimationPlayer,
  first: number,
  count: number,
): number[] {
  return Array.from({ length: count }, (_, offset) => {
    player.advance(T0 + (first + offset) * PERIOD);
    return player.frameIndex;
  });
}

describe('AnimationPlayer', () => {
  it('shows frame 0 at once and loops the whole file', () => {
    const animation = film(3);
    const player = new AnimationPlayer('/a.anim', animation, request(), T0);

    expect(player.path).toBe('/a.anim');
    expect(player.animation).toBe(animation);
    expect(player.frameIndex).toBe(0);
    expect(player.frame).toBe(animation.frames[0]);
    expect(fires(player, 1, 6)).toStrictEqual([1, 2, 0, 1, 2, 0]);
    expect(player.frame).toBe(animation.frames[0]);
    expect(player.finished).toBe(false);
  });

  it.each([
    [60, 16],
    [30, 40],
    [33, 32],
    [10, 104],
    [7, 144],
    [125, 8],
    [500, 8],
    [2000, 8],
    [1, 1000],
    [0.5, 2000],
  ])('shows a frame of a %d fps file every %d ms', (fps, period) => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(3, {}, fps),
      request(),
      T0,
    );
    player.advance(T0 + period - 1);

    expect(player.frameIndex).toBe(0);

    player.advance(T0 + period);

    expect(player.frameIndex).toBe(1);

    player.advance(T0 + 2 * period - 1);

    expect(player.frameIndex).toBe(1);

    player.advance(T0 + 2 * period);

    expect(player.frameIndex).toBe(2);
  });

  it('ignores times before the next fire', () => {
    const player = new AnimationPlayer('/a.anim', film(3), request(), T0);
    player.advance(T0 - 10 * PERIOD);
    player.advance(T0 + PERIOD - 1);

    expect(player.frameIndex).toBe(0);
  });

  it('shows every frame that came due, catching up 1000 at most', () => {
    const player = new AnimationPlayer('/a.anim', film(7), request(), T0);
    player.advance(T0 + 3 * PERIOD);

    expect(player.frameIndex).toBe(3);

    // 5000 fires are due: the oldest 4000 are skipped and 1000 shown, so
    // the frame is (3 + 1000) % 7, not (3 + 5000) % 7.
    player.advance(T0 + 5003 * PERIOD);

    expect(player.frameIndex).toBe(2);
    expect(fires(player, 5004, 2)).toStrictEqual([3, 4]);
  });

  it('plays a one-shot request to its last frame, then stops the timer', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(3),
      request('default', { loop: false }),
      T0,
    );

    expect(fires(player, 1, 2)).toStrictEqual([1, 2]);
    expect(player.finished).toBe(false);

    // The timer stops at the fire after the last frame, which stays.
    player.advance(T0 + 3 * PERIOD);

    expect(player.finished).toBe(true);
    expect(player.frameIndex).toBe(2);

    player.advance(T0 + 100 * PERIOD);

    expect(player.frameIndex).toBe(2);
  });

  it('starts a known section at once', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(4, { tail: { start: 2, end: 3 } }),
      request('tail'),
      T0,
    );

    expect(player.frameIndex).toBe(2);
    expect(fires(player, 1, 4)).toStrictEqual([3, 2, 3, 2]);
  });

  it('keeps looping the whole file when the section is unknown', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(3, { tail: { start: 1, end: 2 } }),
      request('missing', { loop: false }),
      T0,
    );

    expect(fires(player, 1, 4)).toStrictEqual([1, 2, 0, 1]);
    expect(player.finished).toBe(false);
  });

  it('plays a "default" section from the file instead of every frame', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(4, { default: { start: 1, end: 2 } }),
      request(),
      T0,
    );

    expect(player.frameIndex).toBe(1);
    expect(fires(player, 1, 3)).toStrictEqual([2, 1, 2]);
  });

  it('lets the whole file play out before an awaiting section', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(4, { tail: { start: 2, end: 3 } }),
      request('tail', { loop: false, awaitPreviousEnd: true }),
      T0,
    );

    expect(player.frameIndex).toBe(0);
    expect(fires(player, 1, 5)).toStrictEqual([1, 2, 3, 2, 3]);
    expect(player.finished).toBe(false);
    expect(fires(player, 6, 1)).toStrictEqual([3]);
    expect(player.finished).toBe(true);
  });

  it('switches at once when an awaiting request comes on the last frame', () => {
    const player = new AnimationPlayer(
      '/a.anim',
      film(4, { head: { start: 0, end: 1 } }),
      request(),
      T0,
    );
    player.advance(T0 + 3 * PERIOD);

    expect(player.frameIndex).toBe(3);

    player.play(request('head', { awaitPreviousEnd: true }));

    expect(fires(player, 4, 3)).toStrictEqual([0, 1, 0]);
  });

  it('restarts at the section start at the next fire for a plain request', () => {
    const sections = { mid: { start: 2, end: 3 } };
    const player = new AnimationPlayer(
      '/a.anim',
      film(5, sections),
      request(),
      T0,
    );
    player.advance(T0 + PERIOD);
    player.play(request('mid'));

    expect(player.frameIndex).toBe(1);
    expect(fires(player, 2, 3)).toStrictEqual([2, 3, 2]);
  });

  it('moves on from a section start that is already on screen', () => {
    // The bar compares the frame on screen with the requested one, so a
    // section starting at the shown frame goes on to its next frame.
    const sections = { mid: { start: 2, end: 3 } };
    const player = new AnimationPlayer(
      '/a.anim',
      film(5, sections),
      request(),
      T0,
    );
    player.advance(T0 + 2 * PERIOD);
    player.play(request('mid'));

    expect(fires(player, 3, 3)).toStrictEqual([3, 2, 3]);
  });

  it('lets a newer awaiting request replace a pending one', () => {
    const sections = {
      first: { start: 0, end: 0 },
      second: { start: 3, end: 4 },
    };
    const player = new AnimationPlayer(
      '/a.anim',
      film(5, sections),
      request(),
      T0,
    );
    player.play(request('first', { awaitPreviousEnd: true }));
    player.play(request('second', { awaitPreviousEnd: true }));

    expect(fires(player, 1, 7)).toStrictEqual([1, 2, 3, 4, 3, 4, 3]);
  });

  it('drops a pending request when a plain one starts another section', () => {
    const sections = { head: { start: 0, end: 1 }, tail: { start: 3, end: 4 } };
    const player = new AnimationPlayer(
      '/a.anim',
      film(5, sections),
      request(),
      T0,
    );
    player.play(request('tail', { awaitPreviousEnd: true }));
    player.play(request('head'));

    expect(fires(player, 1, 4)).toStrictEqual([1, 0, 1, 0]);
  });

  it('stays on its last frame once stopped, whatever comes next', () => {
    const sections = { head: { start: 0, end: 1 } };
    const player = new AnimationPlayer(
      '/a.anim',
      film(3, sections),
      request('default', { loop: false }),
      T0,
    );
    player.advance(T0 + 3 * PERIOD);

    expect(player.finished).toBe(true);

    // The bar does not restart a stopped timer when a draw picks a section.
    player.play(request('head'));
    player.play(request('default', { awaitPreviousEnd: true }));
    player.advance(T0 + 50 * PERIOD);

    expect(player.finished).toBe(true);
    expect(player.frameIndex).toBe(2);
  });

  it('loops a single frame and stops a one-shot after one period', () => {
    const looping = new AnimationPlayer('/a.anim', film(1), request(), T0);

    expect(fires(looping, 1, 3)).toStrictEqual([0, 0, 0]);
    expect(looping.finished).toBe(false);

    const once = new AnimationPlayer(
      '/a.anim',
      film(1),
      request('default', { loop: false, awaitPreviousEnd: true }),
      T0,
    );
    once.advance(T0 + PERIOD);

    expect(once.finished).toBe(true);
    expect(once.frameIndex).toBe(0);
  });

  it('shows nothing and ignores requests without a loaded file', () => {
    const player = new AnimationPlayer(
      '/missing.anim',
      undefined,
      request(),
      T0,
    );
    player.play(request('tail'));
    player.advance(T0 + 10 * PERIOD);

    expect(player.path).toBe('/missing.anim');
    expect(player.animation).toBeUndefined();
    expect(player.frame).toBeUndefined();
    expect(player.frameIndex).toBe(-1);
    expect(player.finished).toBe(false);
  });
});
