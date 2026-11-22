import type {
  DisplayClearParams,
  DisplayDrawParams,
  RequestOptions,
} from '@busy-app/busy-lib';

import { isAborted, sleep } from './sleep.ts';

/** The display elements one frame of an app draws. */
export type BarElements = DisplayDrawParams['elements'];

/**
 * The part of the busy-lib `BusyBar` client that {@link runBarApp} uses.
 * Declared structurally because busy-lib types each method's `this` as the
 * whole client, which a `Pick` cannot satisfy.
 */
export interface BarDisplayClient {
  DisplayDraw(
    params: DisplayDrawParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  DisplayClear(
    params?: DisplayClearParams,
    options?: RequestOptions,
  ): Promise<unknown>;
}

export interface RunBarAppOptions {
  /**
   * The `application_name` everything the app draws belongs to. The bar groups
   * elements by it, and the app clears them by it when it stops.
   */
  readonly name: string;
  readonly client: BarDisplayClient;
  /** Map the current time to the elements to draw. Keep it pure. */
  readonly render: (now: Date) => BarElements;
  /** Time between frames, in milliseconds. */
  readonly intervalMs: number;
  /**
   * Draw priority, an integer from 1 to 100; defaults to the bar's 50. The bar
   * accepts a draw from the app on screen at or above its priority, and from
   * another app only above it. Built-in apps run at 10; while a BUSY timer
   * runs or is paused the bar refuses every draw.
   */
  readonly priority?: number;
  /**
   * Ends the loop, and aborts a draw or deletion in flight; see
   * {@link shutdownSignal}.
   */
  readonly signal: AbortSignal;
  readonly now?: () => Date;
  readonly log?: Pick<Console, 'warn'>;
}

/** The bar's default draw priority. */
export const DEFAULT_PRIORITY = 50;

/** The lowest draw priority the bar accepts. */
export const MIN_PRIORITY = 1;

/** The highest draw priority the bar accepts. */
export const MAX_PRIORITY = 100;

/**
 * Draw a frame every `intervalMs` until `signal` aborts, then clear the
 * display. The bar merges each draw into what the app already shows, by
 * element id, so elements the last frame drew and this one does not are
 * deleted after the draw. Failed draws and deletions are logged and retried
 * on later frames, so an app survives the bar dropping off Wi-Fi. An
 * exception thrown by `render` is a bug: it clears the display and rejects.
 */
export async function runBarApp(options: RunBarAppOptions): Promise<void> {
  const {
    name,
    client,
    render,
    intervalMs,
    signal,
    priority = DEFAULT_PRIORITY,
    now = () => new Date(),
    log = console,
  } = options;

  if (
    !Number.isInteger(priority) ||
    priority < MIN_PRIORITY ||
    priority > MAX_PRIORITY
  ) {
    throw new RangeError(
      `Draw priority must be an integer from ${MIN_PRIORITY} to ${MAX_PRIORITY}; got ${priority}.`,
    );
  }

  // IDs that may still be displayed, including deletions awaiting a retry.
  let shown = new Set<string>();
  try {
    while (!signal.aborted) {
      const elements = render(now());
      let operation = 'Drawing on';
      try {
        await client.DisplayDraw(
          { application_name: name, priority, elements },
          { signal },
        );
        const drawn = new Set(elements.map((element) => element.id));
        const stale = [...shown].filter((id) => !drawn.has(id));
        shown = new Set([...shown, ...drawn]);
        if (stale.length > 0) {
          operation = 'Deleting stale elements from';
          await deleteElements(client, name, stale, signal);
        }
        shown = drawn;
      } catch (error) {
        // An abort during the request rejects it; that is the shutdown, not a
        // failure worth logging.
        if (!isAborted(signal)) {
          log.warn(`[${name}] ${operation} the BUSY Bar failed:`, error);
        }
      }
      await sleep(intervalMs, signal);
    }
  } finally {
    try {
      await client.DisplayClear({ application_name: name });
    } catch (error) {
      log.warn(`[${name}] Clearing the BUSY Bar display failed:`, error);
    }
  }
}

/**
 * Delete `ids` from the app's canvas. The bar refuses the whole request
 * with a 400 when one of them is gone already, as after BACK or the mode
 * switch closed the canvas or the BUSY timer took the screen. Then each id
 * is deleted on its own, and those the bar no longer has are forgotten. Any
 * other failure throws, so every id is tried again on a later frame.
 */
async function deleteElements(
  client: BarDisplayClient,
  name: string,
  ids: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  const remove = (elementIds: string[]): Promise<unknown> =>
    client.DisplayClear(
      { application_name: name, element_ids: elementIds },
      { signal },
    );
  try {
    await remove([...ids]);
  } catch (error) {
    if (!isGone(error)) {
      throw error;
    }
    for (const id of ids.length > 1 ? ids : []) {
      try {
        await remove([id]);
      } catch (single) {
        if (!isGone(single)) {
          throw single;
        }
      }
    }
  }
}

/** busy-lib's error for a 400: the bar holds no such element for the app. */
function isGone(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 400;
}

/** Anything that reports process signals, such as `process`. */
export interface SignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/**
 * A signal that aborts on SIGINT or SIGTERM, so both Ctrl+C and a process
 * manager stopping the app end {@link runBarApp} cleanly. The first signal
 * also hands both back to Node, so a second one ends the process at once,
 * without clearing the display, for when the bar does not answer. The Python
 * kit's `install_shutdown_handlers` behaves the same way.
 */
export function shutdownSignal(target: SignalSource = process): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => {
    target.off('SIGINT', abort);
    target.off('SIGTERM', abort);
    controller.abort();
  };
  target.on('SIGINT', abort);
  target.on('SIGTERM', abort);
  return controller.signal;
}
