// How the bar plays an animation element, frame by frame
// (applications/services/gui/modules/anim_player.c and lib/anim_file in
// the firmware): a timer shows one frame per period, sections play once or
// loop, and a section can wait for the current one to finish.

import type { Animation } from '../formats/animation.ts';
import type { Bitmap } from '../formats/png.ts';

/** The GUI thread runs LVGL's timers every 8 ms (GUI_TICK_PERIOD_MS). */
const GUI_TICK_MS = 8;

/** The most frames one `advance` catches up on; beyond that it skips ahead. */
const MAX_CATCH_UP = 1000;

interface Range {
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
  readonly finishCurrent: boolean;
}

/** What an animation element asks the player for. */
export interface PlayRequest {
  readonly section: string;
  readonly loop: boolean;
  readonly awaitPreviousEnd: boolean;
}

/**
 * One animation element's playback. Built when an element names a file
 * that differs from what it showed before; a redraw naming the same file
 * only picks a section again, as on the bar.
 */
export class AnimationPlayer {
  /** What the element's path resolves to on the bar, to spot a new file. */
  readonly path: string;
  /** Undefined when the file could not be loaded: the bar shows an error icon. */
  readonly animation: Animation | undefined;
  readonly #period: number;
  #anchor: number;
  #fired = 0;
  #paused = false;
  #active: Range;
  #pending: Range | undefined;
  #frame = 0;
  #lastFrame: number;
  #shown = -1;

  constructor(
    path: string,
    animation: Animation | undefined,
    request: PlayRequest,
    now: number,
  ) {
    this.path = path;
    this.animation = animation;
    this.#anchor = now;
    const end = Math.max(0, (animation?.frames.length ?? 1) - 1);
    // A new file first loops the whole of itself, then takes the request.
    this.#active = { start: 0, end, loop: true, finishCurrent: false };
    this.#lastFrame = end;
    const period = Math.floor(1000 / (animation?.fps ?? 1));
    this.#period = Math.max(
      GUI_TICK_MS,
      Math.ceil(period / GUI_TICK_MS) * GUI_TICK_MS,
    );
    this.play(request);
    this.advance(now);
  }

  /** The frame on screen, or undefined before the first one. */
  get frame(): Bitmap | undefined {
    return this.#shown === -1 ? undefined : this.animation?.frames[this.#shown];
  }

  /** The index of the frame on screen, -1 before the first one. */
  get frameIndex(): number {
    return this.#shown;
  }

  /** Whether a one-shot section played out and the timer stopped. */
  get finished(): boolean {
    return this.#paused;
  }

  /**
   * Pick a section, as each draw of the element does. An unknown name
   * changes nothing; otherwise the section starts over at once, or after
   * the current one's last frame when the request awaits it. A finished
   * player stays on its last frame: the bar does not restart its timer.
   */
  play(request: PlayRequest): void {
    const animation = this.animation;
    if (animation === undefined) {
      return;
    }
    const section =
      animation.sections.get(request.section) ??
      (request.section === 'default'
        ? { start: 0, end: animation.frames.length - 1 }
        : undefined);
    if (section === undefined) {
      return;
    }
    const range: Range = {
      start: section.start,
      end: section.end,
      loop: request.loop,
      finishCurrent: request.awaitPreviousEnd,
    };
    if (range.finishCurrent && this.#frame !== this.#active.end) {
      this.#pending = range;
      return;
    }
    this.#activate(range);
  }

  /** Show every frame due by `now`. */
  advance(now: number): void {
    if (this.animation === undefined) {
      return;
    }
    let due = Math.floor((now - this.#anchor) / this.#period) + 1 - this.#fired;
    if (due > MAX_CATCH_UP) {
      this.#fired += due - MAX_CATCH_UP;
      due = MAX_CATCH_UP;
    }
    for (; due > 0 && !this.#paused; due -= 1) {
      this.#fired += 1;
      this.#step();
    }
  }

  /** One timer tick: anim_file_seq_draw_requested_and_go_to_next. */
  #step(): void {
    if (this.#shown === this.#frame) {
      if (this.#frame === this.#lastFrame) {
        if (this.#pending !== undefined) {
          this.#activate(this.#pending);
        } else if (this.#active.loop) {
          this.#frame = this.#active.start;
        } else {
          this.#paused = true;
          return;
        }
      } else {
        this.#frame += 1;
      }
    }
    this.#shown = this.#frame;
  }

  #activate(range: Range): void {
    this.#active = range;
    this.#pending = undefined;
    this.#frame = range.start;
    this.#lastFrame = range.end;
  }
}
