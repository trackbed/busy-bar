import { describe, expect, it, vi } from 'vitest';

import { createPoller } from './poller.ts';

const FIRST = new Date('2026-10-20T12:00:00Z');
const SECOND = new Date('2026-10-20T12:00:30Z');

/** A clock that returns each of `times` in turn, then keeps the last. */
function clock(...times: Date[]): () => Date {
  let index = 0;
  return () => {
    const time = times[Math.min(index, times.length - 1)] ?? FIRST;
    index += 1;
    return time;
  };
}

describe('createPoller', () => {
  it('has nothing to show before the first fetch', () => {
    const poller = createPoller({
      name: 'demo',
      fetch: () => Promise.resolve(1),
      intervalMs: 0,
    });

    expect(poller.latest()).toBeUndefined();
    expect(poller.failure()).toBeUndefined();
  });

  it('keeps the latest value and when it arrived', async () => {
    const controller = new AbortController();
    let calls = 0;
    const poller = createPoller({
      name: 'demo',
      fetch: () => {
        calls += 1;
        if (calls === 2) {
          controller.abort();
        }
        return Promise.resolve(calls);
      },
      intervalMs: 0,
      now: clock(FIRST, SECOND),
    });

    await poller.run(controller.signal);

    expect(poller.latest()).toStrictEqual({ value: 2, at: SECOND });
    expect(poller.failure()).toBeUndefined();
  });

  it('passes the signal on to the fetch', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<(signal: AbortSignal) => Promise<boolean>>((signal) => {
      controller.abort();
      return Promise.resolve(signal.aborted);
    });
    const poller = createPoller({ name: 'demo', fetch, intervalMs: 0 });

    await poller.run(controller.signal);

    expect(fetch).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('logs a failed fetch and keeps the previous value', async () => {
    const controller = new AbortController();
    let calls = 0;
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };
    const poller = createPoller({
      name: 'demo',
      fetch: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve('fresh');
        }
        controller.abort();
        return Promise.reject(new Error('offline'));
      },
      intervalMs: 0,
      now: clock(FIRST, SECOND),
      log,
    });

    await poller.run(controller.signal);

    // The abort landed before the rejection, so this failure is the shutdown.
    expect(poller.latest()).toStrictEqual({ value: 'fresh', at: FIRST });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('records a failure until the next fetch succeeds', async () => {
    const controller = new AbortController();
    let calls = 0;
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };
    const failures: unknown[] = [];
    const poller = createPoller({
      name: 'demo',
      fetch: () => {
        calls += 1;
        failures.push(poller.failure());
        if (calls === 1) {
          return Promise.reject(new Error('offline'));
        }
        controller.abort();
        return Promise.resolve('back');
      },
      intervalMs: 0,
      now: clock(FIRST, SECOND),
      log,
    });

    await poller.run(controller.signal);

    expect(failures).toStrictEqual([
      undefined,
      { error: new Error('offline'), at: FIRST },
    ]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[demo] Fetching failed:',
      new Error('offline'),
    );
    expect(poller.latest()).toStrictEqual({ value: 'back', at: SECOND });
    expect(poller.failure()).toBeUndefined();
  });

  it('waits the interval between fetches and stops at once when aborted', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetch = vi.fn<() => Promise<string>>(() =>
        Promise.resolve('value'),
      );
      const poller = createPoller({ name: 'demo', fetch, intervalMs: 60_000 });

      const running = poller.run(controller.signal);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetch).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);

      controller.abort();
      await running;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tries again sooner after a failed fetch when asked to', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let calls = 0;
      const fetch = vi.fn<() => Promise<string>>(() => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('busy'))
          : Promise.resolve('value');
      });
      const poller = createPoller({
        name: 'demo',
        fetch,
        intervalMs: 60_000,
        retryMs: 5000,
        log: { warn: vi.fn<(...data: unknown[]) => void>() },
      });

      const running = poller.run(controller.signal);
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetch).toHaveBeenCalledTimes(2);

      controller.abort();
      await running;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fetch when the signal has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<() => Promise<string>>(() => Promise.resolve('value'));

    await createPoller({ name: 'demo', fetch, intervalMs: 0 }).run(
      controller.signal,
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});
