import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type { BarDisplayClient, BarElements } from './run-bar-app.ts';
import { DEFAULT_PRIORITY, runBarApp, shutdownSignal } from './run-bar-app.ts';

const NOW = new Date('2026-10-19T12:00:00Z');
const FRAME: BarElements = [
  { id: 'hello', type: 'text', text: 'HELLO', font: 'small' },
];

/** A client that aborts the app after `frames` successful or failed draws. */
function fakeClient(
  controller: AbortController,
  frames: number,
  draw: () => Promise<void> = () => Promise.resolve(),
) {
  let drawn = 0;
  const client = {
    DisplayDraw: vi.fn<BarDisplayClient['DisplayDraw']>(async () => {
      drawn += 1;
      if (drawn >= frames) {
        controller.abort();
      }
      await draw();
      return { result: 'OK' };
    }),
    DisplayClear: vi.fn<BarDisplayClient['DisplayClear']>(() =>
      Promise.resolve({ result: 'OK' }),
    ),
  };
  return client satisfies BarDisplayClient;
}

describe('runBarApp', () => {
  it('draws a frame per interval and clears the display when stopped', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 2);
    const render = vi.fn<(now: Date) => BarElements>(() => FRAME);

    await runBarApp({
      name: 'demo',
      client,
      render,
      intervalMs: 0,
      signal: controller.signal,
      now: () => NOW,
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledWith(NOW);
    expect(client.DisplayDraw).toHaveBeenCalledWith(
      { application_name: 'demo', priority: DEFAULT_PRIORITY, elements: FRAME },
      { signal: controller.signal },
    );
    expect(client.DisplayClear).toHaveBeenCalledExactlyOnceWith({
      application_name: 'demo',
    });
  });

  it('draws at the requested priority', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 1);

    await runBarApp({
      name: 'demo',
      client,
      render: () => FRAME,
      intervalMs: 0,
      priority: 95,
      signal: controller.signal,
    });

    expect(client.DisplayDraw).toHaveBeenCalledWith(
      { application_name: 'demo', priority: 95, elements: FRAME },
      { signal: controller.signal },
    );
  });

  it.each([0, 101, 1.5])(
    'rejects priority %s before drawing anything',
    async (priority) => {
      const controller = new AbortController();
      const client = fakeClient(controller, 1);

      await expect(
        runBarApp({
          name: 'demo',
          client,
          render: () => FRAME,
          intervalMs: 0,
          priority,
          signal: controller.signal,
        }),
      ).rejects.toThrow(RangeError);
      expect(client.DisplayDraw).not.toHaveBeenCalled();
      expect(client.DisplayClear).not.toHaveBeenCalled();
    },
  );

  it('logs a failed draw and keeps running', async () => {
    const controller = new AbortController();
    let calls = 0;
    const client = fakeClient(controller, 2, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('bar offline'))
        : Promise.resolve();
    });
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };

    await runBarApp({
      name: 'demo',
      client,
      render: () => FRAME,
      intervalMs: 0,
      signal: controller.signal,
      log,
    });

    expect(client.DisplayDraw).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[demo] Drawing on the BUSY Bar failed:',
      new Error('bar offline'),
    );
  });

  it('clears the display and rejects when render throws', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 1);

    await expect(
      runBarApp({
        name: 'demo',
        client,
        render: () => {
          throw new Error('render bug');
        },
        intervalMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow('render bug');
    expect(client.DisplayDraw).not.toHaveBeenCalled();
    expect(client.DisplayClear).toHaveBeenCalledOnce();
  });

  it('logs a failed clear instead of throwing', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = fakeClient(controller, 1);
    client.DisplayClear.mockRejectedValueOnce(new Error('bar offline'));
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };

    await runBarApp({
      name: 'demo',
      client,
      render: () => FRAME,
      intervalMs: 0,
      signal: controller.signal,
      log,
    });

    expect(client.DisplayDraw).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[demo] Clearing the BUSY Bar display failed:',
      new Error('bar offline'),
    );
  });

  it('stops waiting for the next frame as soon as it is aborted', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const client = fakeClient(controller, Number.POSITIVE_INFINITY);
      const running = runBarApp({
        name: 'demo',
        client,
        render: () => FRAME,
        intervalMs: 60_000,
        signal: controller.signal,
      });

      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await running;

      expect(client.DisplayDraw).toHaveBeenCalledOnce();
      expect(client.DisplayClear).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shutdownSignal', () => {
  it.each(['SIGINT', 'SIGTERM'])('aborts on %s', (event) => {
    const target = new EventEmitter();

    const signal = shutdownSignal(target);
    expect(signal.aborted).toBe(false);

    target.emit(event);
    expect(signal.aborted).toBe(true);
  });
});
