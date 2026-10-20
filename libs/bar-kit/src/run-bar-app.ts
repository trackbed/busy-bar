import type {
  DisplayClearParams,
  DisplayDrawParams,
  RequestOptions,
} from '@busy-app/busy-lib';

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
   * accepts a draw only at or above the priority of the app on screen:
   * built-in apps run at 10 and an active BUSY or CUSTOM work session at 90.
   */
  readonly priority?: number;
  /** Ends the loop; see {@link shutdownSignal}. */
  readonly signal: AbortSignal;
  readonly now?: () => Date;
  readonly log?: Pick<Console, 'warn'>;
}

/** The bar's default draw priority. */
export const DEFAULT_PRIORITY = 50;

/**
 * Draw a frame every `intervalMs` until `signal` aborts, then clear the
 * display. Failed draws are logged and retried on the next frame, so an app
 * survives the bar rebooting or dropping off Wi-Fi. An exception thrown by
 * `render` is a bug: it clears the display and rejects.
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

  if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
    throw new RangeError(
      `Draw priority must be an integer from 1 to 100; got ${priority}.`,
    );
  }

  try {
    while (!signal.aborted) {
      const elements = render(now());
      try {
        await client.DisplayDraw(
          { application_name: name, priority, elements },
          { signal },
        );
      } catch (error) {
        // An abort during the request rejects it; that is the shutdown, not a
        // failure worth logging.
        if (!isAborted(signal)) {
          log.warn(`[${name}] Drawing on the BUSY Bar failed:`, error);
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

/** Anything that reports process signals, such as `process`. */
export interface SignalSource {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

/**
 * A signal that aborts on SIGINT or SIGTERM, so both Ctrl+C and a process
 * manager stopping the app end {@link runBarApp} cleanly.
 */
export function shutdownSignal(target: SignalSource = process): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  target.once('SIGINT', abort);
  target.once('SIGTERM', abort);
  return controller.signal;
}

// Reads `aborted` through a call so TypeScript does not narrow it to the value
// the loop condition saw before an `await`.
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });

    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}
