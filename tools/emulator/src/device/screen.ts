// The canvas the HTTP API draws on, with the firmware's rules for who may
// draw, how draws merge, and when elements expire
// (applications/services/canvas/canvas.c in the firmware).

import type { Animation } from '../formats/animation.ts';
import { AnimationPlayer } from './animation-player.ts';
import { ApiError } from './api-error.ts';
import type { AnimationElement, DrawRequest, Element } from './elements.ts';
import { MAX_ELEMENTS } from './elements.ts';

/** One element on screen, with its stacking and timing. */
export interface PlacedElement {
  readonly element: Element;
  /** Higher draws on top. */
  readonly z: number;
  /** Milliseconds since the epoch, or undefined for no expiry. */
  readonly expiresAt: number | undefined;
  /** When the element was last drawn: a text's scroll starts over here. */
  readonly since: number;
  /** An animation's playback, carried across redraws of the same file. */
  readonly player: AnimationPlayer | undefined;
}

/** The file an animation element resolves to, loaded or not. */
export type AnimationResolver = (
  element: AnimationElement,
  application: string,
) => { readonly path: string; readonly animation: Animation | undefined };

/** The loader priority while no built-in app has the screen. */
export const IDLE_PRIORITY = 9;
/** The loader priority while the BUSY timer runs or is paused: no draw passes. */
export const TIMER_PRIORITY = 101;
/** How long a refused draw waits for the screen to free up before its 409. */
export const HOLD_MS = 1500;

const Z_STEP = 10;

export type DrawResult = 'drawn' | 'low-priority';

interface Held {
  readonly request: DrawRequest;
  readonly resolve: (result: DrawResult) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** The app canvas on both displays. */
export class Screen {
  readonly #now: () => number;
  readonly #onChange: () => void;
  readonly #animations: AnimationResolver;
  #owner: { readonly app: string; readonly priority: number } | undefined;
  readonly #elements = new Map<string, PlacedElement>();
  #loaderPriority = IDLE_PRIORITY;
  #held: Held | undefined;

  constructor(
    options: {
      readonly now?: () => number;
      readonly onChange?: () => void;
      readonly animations?: AnimationResolver;
    } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#onChange = options.onChange ?? (() => undefined);
    this.#animations =
      options.animations ??
      ((element) => ({ path: element.source.path, animation: undefined }));
  }

  /** The app that has the canvas, while it is open. */
  get owner(): { readonly app: string; readonly priority: number } | undefined {
    return this.#owner;
  }

  get loaderPriority(): number {
    return this.#loaderPriority;
  }

  /** Every element on screen, bottom to top; equal z keeps drawing order. */
  elements(): PlacedElement[] {
    return [...this.#elements.values()].sort((a, b) => a.z - b.z);
  }

  /**
   * Try a validated draw. Resolves `drawn`, or `low-priority` when the
   * screen stays taken for `HOLD_MS` (or a newer refused draw bumps this
   * one). Rejects with `ApiError` for the canvas stage's 400s.
   */
  draw(request: DrawRequest): Promise<DrawResult> {
    if (this.#accepts(request)) {
      // The executor runs at once, so the draw applies before this returns;
      // an error it throws rejects the promise.
      return new Promise((resolve) => {
        this.#apply(request);
        resolve('drawn');
      });
    }
    if (this.#held !== undefined) {
      clearTimeout(this.#held.timer);
      this.#held.resolve('low-priority');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#held = undefined;
        resolve('low-priority');
      }, HOLD_MS);
      this.#held = { request, resolve, reject, timer };
    });
  }

  /**
   * Delete elements, as `DELETE /api/display/draw` does: all of them, or the
   * ones named in `ids`. `app` must own the canvas when given.
   */
  clear(app: string | undefined, ids: readonly string[] | undefined): void {
    if (this.#owner === undefined) {
      if (ids !== undefined) {
        throw new ApiError(400, 'one of element_ids is non-existent');
      }
      return;
    }
    if (app !== undefined && app !== this.#owner.app) {
      throw new ApiError(
        400,
        'this application_name is currently not displaying anything',
      );
    }
    if (ids === undefined) {
      this.close();
      return;
    }
    if (ids.some((id) => !this.#elements.has(id))) {
      throw new ApiError(400, 'one of element_ids is non-existent');
    }
    for (const id of ids) {
      this.#elements.delete(id);
    }
    this.#closeIfEmpty();
    this.#onChange();
  }

  /** Remove every element, as a button press or a higher loader does. */
  close(): void {
    const had = this.#owner !== undefined;
    this.#elements.clear();
    this.#owner = undefined;
    if (had) {
      this.#onChange();
    }
  }

  /** Drop expired elements and move animations on; call it every frame. */
  tick(): void {
    const now = this.#now();
    let changed = false;
    for (const [id, placed] of this.#elements) {
      if (placed.expiresAt !== undefined && placed.expiresAt <= now) {
        this.#elements.delete(id);
        changed = true;
      } else {
        placed.player?.advance(now);
      }
    }
    if (changed) {
      this.#closeIfEmpty();
      this.#onChange();
    }
  }

  /**
   * Change what the built-in loader holds the screen at. A rise above the
   * canvas's priority closes it; any change retries a held draw.
   */
  setLoaderPriority(priority: number): void {
    this.#loaderPriority = priority;
    if (this.#owner !== undefined && priority > this.#owner.priority) {
      this.close();
    }
    const held = this.#held;
    if (held === undefined || !this.#accepts(held.request)) {
      return;
    }
    clearTimeout(held.timer);
    this.#held = undefined;
    try {
      this.#apply(held.request);
      held.resolve('drawn');
    } catch (error) {
      held.reject(error);
    }
  }

  #accepts(request: DrawRequest): boolean {
    const owner = this.#owner;
    const threshold =
      owner === undefined || this.#loaderPriority > owner.priority
        ? this.#loaderPriority
        : owner.priority;
    if (owner === undefined || owner.app === request.applicationName) {
      return request.priority >= threshold;
    }
    return request.priority > threshold;
  }

  /**
   * Apply a draw element by element, like canvas_update_all: a bad element
   * stops the draw, but the ones before it stay on screen.
   */
  #apply(request: DrawRequest): void {
    const now = this.#now();
    const nowSeconds = Math.floor(now / 1000);
    // A display_until runs for whole seconds from the draw, as the bar's
    // seconds clock counts them.
    const lifetime = (element: Element): number | undefined => {
      if (element.timeout !== undefined) {
        return element.timeout;
      }
      return element.displayUntil === undefined
        ? undefined
        : Math.max(0, element.displayUntil - nowSeconds);
    };
    if (
      this.#owner === undefined &&
      request.elements.every((element) => lifetime(element) === 0)
    ) {
      throw new ApiError(400, 'Nothing to display');
    }
    if (
      this.#owner !== undefined &&
      this.#owner.app !== request.applicationName
    ) {
      this.#elements.clear();
    }
    this.#owner = { app: request.applicationName, priority: request.priority };
    let failure: ApiError | undefined;
    let defaultZ = 0;
    for (const element of request.elements) {
      const z = element.zIndex ?? defaultZ;
      if (element.zIndex === undefined) {
        defaultZ += Z_STEP;
      }
      const existing = this.#elements.get(element.id);
      if (
        existing !== undefined &&
        (existing.element.type !== element.type ||
          existing.element.display !== element.display)
      ) {
        failure = new ApiError(400, 'Unspecified request error');
        break;
      }
      const seconds = lifetime(element);
      if (seconds === 0) {
        this.#elements.delete(element.id);
        continue;
      }
      this.#elements.set(element.id, {
        element,
        z,
        expiresAt: seconds === undefined ? undefined : now + seconds * 1000,
        since: now,
        player:
          element.type === 'animation'
            ? this.#player(
                existing?.player,
                element,
                request.applicationName,
                now,
              )
            : undefined,
      });
      if (this.#elements.size > MAX_ELEMENTS) {
        failure = new ApiError(400, 'Elements number limit exceeded');
        break;
      }
    }
    this.#closeIfEmpty();
    this.#onChange();
    if (failure !== undefined) {
      throw failure;
    }
  }

  /** Keep playing a file the element already shows; load anything else. */
  #player(
    current: AnimationPlayer | undefined,
    element: AnimationElement,
    application: string,
    now: number,
  ): AnimationPlayer {
    const { path, animation } = this.#animations(element, application);
    if (current?.path === path) {
      // The bar's timer keeps firing between ticks: catch up before the
      // new section is picked, or a timer that stopped would play on.
      current.advance(now);
      current.play(element);
      return current;
    }
    return new AnimationPlayer(path, animation, element, now);
  }

  #closeIfEmpty(): void {
    if (this.#elements.size === 0) {
      this.#owner = undefined;
    }
  }
}
