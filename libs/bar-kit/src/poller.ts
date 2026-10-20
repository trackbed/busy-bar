import { isAborted, sleep } from './sleep.ts';

/** A value a {@link Poller} fetched, and when the fetch finished. */
export interface Snapshot<T> {
  readonly value: T;
  readonly at: Date;
}

/** Why the most recent fetch of a {@link Poller} failed, and when. */
export interface PollFailure {
  readonly error: unknown;
  readonly at: Date;
}

export interface PollerOptions<T> {
  /** Names the data source in log messages. */
  readonly name: string;
  /**
   * Fetch the current value. Pass `signal` on to the request, so stopping the
   * app cancels a fetch in flight.
   */
  readonly fetch: (signal: AbortSignal) => Promise<T>;
  /** Time from the end of one fetch to the start of the next, in milliseconds. */
  readonly intervalMs: number;
  /**
   * Time to wait after a failed fetch instead, so a source that refused once
   * is asked again soon. Defaults to `intervalMs`.
   */
  readonly retryMs?: number;
  readonly now?: () => Date;
  readonly log?: Pick<Console, 'warn'>;
}

/**
 * The latest value of a data source an app draws, refreshed in the
 * background. A render function reads {@link Poller.latest} and stays pure.
 */
export interface Poller<T> {
  /** The most recent successful fetch, or `undefined` before the first. */
  latest(): Snapshot<T> | undefined;
  /** How the most recent fetch failed, or `undefined` if it succeeded. */
  failure(): PollFailure | undefined;
  /**
   * Fetch at once and then every `intervalMs` until `signal` aborts. A failed
   * fetch is logged and kept as {@link Poller.failure}, and the previous value
   * stays available, so a flaky source shows stale data instead of none. The
   * next try comes after `retryMs`.
   */
  run(signal: AbortSignal): Promise<void>;
}

/** Create a {@link Poller}; start it with {@link Poller.run}. */
export function createPoller<T>(options: PollerOptions<T>): Poller<T> {
  const {
    name,
    fetch,
    intervalMs,
    retryMs = intervalMs,
    now = () => new Date(),
    log = console,
  } = options;
  let latest: Snapshot<T> | undefined;
  let failure: PollFailure | undefined;

  return {
    latest: () => latest,
    failure: () => failure,
    async run(signal) {
      while (!isAborted(signal)) {
        try {
          const value = await fetch(signal);
          latest = { value, at: now() };
          failure = undefined;
        } catch (error) {
          // An abort during the request rejects it; that is the shutdown.
          if (isAborted(signal)) {
            return;
          }
          failure = { error, at: now() };
          log.warn(`[${name}] Fetching failed:`, error);
        }
        await sleep(failure === undefined ? intervalMs : retryMs, signal);
      }
    },
  };
}
