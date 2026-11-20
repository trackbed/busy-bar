import { describe, expect, it, vi } from 'vitest';

import type { Presence } from './convex/presence.ts';
import { HEARTBEAT_MS } from './convex/presence.ts';
import type { ReporterOptions } from './reporter.ts';
import { createReporter, leaveTeam } from './reporter.ts';

type Send = ReporterOptions['send'];

const NOW = 1_761_480_000_000;
const ENDS_AT = NOW + 20 * 60_000;
const FREE: Presence = { state: 'free' };
const BUSY: Presence = { state: 'busy', endsAt: ENDS_AT };

function setup(send = vi.fn<Send>(() => Promise.resolve())) {
  const log = { warn: vi.fn<Console['warn']>() };
  return { send, log, reporter: createReporter({ name: 'test', send, log }) };
}

describe('createReporter', () => {
  it('reports at once, then only changes until a heartbeat is due', async () => {
    const { send, reporter } = setup();

    await reporter.observe(FREE, NOW);
    await reporter.observe(FREE, NOW + HEARTBEAT_MS - 1);
    await reporter.observe(BUSY, NOW + HEARTBEAT_MS - 1);
    await reporter.observe(
      { state: 'busy', endsAt: ENDS_AT },
      NOW + HEARTBEAT_MS,
    );
    await reporter.observe(BUSY, NOW + 2 * HEARTBEAT_MS - 1);

    expect(send.mock.calls).toStrictEqual([[FREE], [BUSY], [BUSY]]);
  });

  it('keeps one report in flight', async () => {
    let finish = (): void => undefined;
    const send = vi
      .fn<Send>(() => Promise.resolve())
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    const { reporter } = setup(send);

    const first = reporter.observe(FREE, NOW);
    await reporter.observe(BUSY, NOW + 1);
    finish();
    await first;
    await reporter.observe(BUSY, NOW + 2);

    expect(send.mock.calls).toStrictEqual([[FREE], [BUSY]]);
  });

  it('tries a failed report again and logs only the first failure', async () => {
    const send = vi
      .fn<Send>(() => Promise.resolve())
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'));
    const { log, reporter } = setup(send);

    await reporter.observe(FREE, NOW);
    await reporter.observe(FREE, NOW + 1);
    await reporter.observe(FREE, NOW + 2);
    await reporter.observe(FREE, NOW + 3);

    expect(send).toHaveBeenCalledTimes(3);
    expect(log.warn.mock.calls).toStrictEqual([
      ['[test] Reporting to the team failed:', new Error('offline')],
    ]);
  });

  it('logs a new run of failures after a report went through', async () => {
    const send = vi
      .fn<Send>(() => Promise.resolve())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline again'));
    const { log, reporter } = setup(send);

    await reporter.observe(FREE, NOW);
    await reporter.observe(FREE, NOW + 1);
    await reporter.observe(BUSY, NOW + 2);

    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

describe('leaveTeam', () => {
  function setup(leave: () => Promise<unknown>) {
    const log = { warn: vi.fn<Console['warn']>() };
    return {
      log,
      done: leaveTeam({ name: 'test', leave, timeoutMs: 2000, log }),
    };
  }

  it('tells the team this bar left', async () => {
    const leave = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));
    const { done, log } = setup(leave);

    await done;

    expect(leave).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('gives up when the deployment does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const { done } = setup(() => new Promise(() => undefined));
      void done.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a failed leave and lets the app stop', async () => {
    const failure = new Error('offline');
    const { done, log } = setup(() => Promise.reject(failure));

    await done;

    expect(log.warn).toHaveBeenCalledWith(
      '[test] Leaving the team failed:',
      failure,
    );
  });
});
