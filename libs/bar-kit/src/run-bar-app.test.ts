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

  it('deletes the elements a frame stops drawing', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 3);
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    const frames: BarElements[] = [[...FRAME, extra], FRAME, FRAME];
    let frame = -1;

    await runBarApp({
      name: 'demo',
      client,
      render: () => {
        frame += 1;
        return frames[frame] ?? FRAME;
      },
      intervalMs: 0,
      signal: controller.signal,
    });

    expect(client.DisplayClear.mock.calls).toStrictEqual([
      [
        { application_name: 'demo', element_ids: ['extra'] },
        { signal: controller.signal },
      ],
      [{ application_name: 'demo' }],
    ]);
  });

  it('retries deletions and remembers IDs drawn while cleanup failed', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 3);
    client.DisplayClear.mockRejectedValueOnce(new Error('bar offline'));
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    const fresh = { ...extra, id: 'fresh' };
    const frames: BarElements[] = [[...FRAME, extra], [...FRAME, fresh], FRAME];
    let frame = 0;
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };

    await runBarApp({
      name: 'demo',
      client,
      render: () => frames[frame++] ?? FRAME,
      intervalMs: 0,
      signal: controller.signal,
      log,
    });

    expect(client.DisplayClear.mock.calls).toStrictEqual([
      [
        { application_name: 'demo', element_ids: ['extra'] },
        { signal: controller.signal },
      ],
      [
        { application_name: 'demo', element_ids: ['extra', 'fresh'] },
        { signal: controller.signal },
      ],
      [{ application_name: 'demo' }],
    ]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[demo] Deleting stale elements from the BUSY Bar failed:',
      new Error('bar offline'),
    );
  });

  it('forgets IDs the bar no longer has and deletes the rest one by one', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 3);
    const gone = Object.assign(
      new Error('one of element_ids is non-existent'),
      { status: 400 },
    );
    client.DisplayClear.mockRejectedValueOnce(gone).mockRejectedValueOnce(gone);
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    const kept = { ...extra, id: 'kept' };
    const frames: BarElements[] = [[...FRAME, extra, kept], FRAME, FRAME];
    let frame = 0;
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };

    await runBarApp({
      name: 'demo',
      client,
      render: () => frames[frame++] ?? FRAME,
      intervalMs: 0,
      signal: controller.signal,
      log,
    });

    const options = { signal: controller.signal };
    expect(client.DisplayClear.mock.calls).toStrictEqual([
      [{ application_name: 'demo', element_ids: ['extra', 'kept'] }, options],
      [{ application_name: 'demo', element_ids: ['extra'] }, options],
      [{ application_name: 'demo', element_ids: ['kept'] }, options],
      [{ application_name: 'demo' }],
    ]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('forgets a single ID the bar no longer has without asking again', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 3);
    client.DisplayClear.mockRejectedValueOnce(
      Object.assign(new Error('one of element_ids is non-existent'), {
        status: 400,
      }),
    );
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    const frames: BarElements[] = [[...FRAME, extra], FRAME, FRAME];
    let frame = 0;

    await runBarApp({
      name: 'demo',
      client,
      render: () => frames[frame++] ?? FRAME,
      intervalMs: 0,
      signal: controller.signal,
    });

    expect(client.DisplayClear.mock.calls).toStrictEqual([
      [
        { application_name: 'demo', element_ids: ['extra'] },
        { signal: controller.signal },
      ],
      [{ application_name: 'demo' }],
    ]);
  });

  it('retries a deletion that fails on its own for another reason', async () => {
    const controller = new AbortController();
    const client = fakeClient(controller, 3);
    client.DisplayClear.mockRejectedValueOnce(
      Object.assign(
        new Error('this application_name is currently not displaying anything'),
        {
          status: 400,
        },
      ),
    ).mockRejectedValueOnce(new Error('bar offline'));
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    const frames: BarElements[] = [
      [...FRAME, extra, { ...extra, id: 'more' }],
      FRAME,
      FRAME,
    ];
    let frame = 0;
    const log = { warn: vi.fn<(...data: unknown[]) => void>() };

    await runBarApp({
      name: 'demo',
      client,
      render: () => frames[frame++] ?? FRAME,
      intervalMs: 0,
      signal: controller.signal,
      log,
    });

    const options = { signal: controller.signal };
    expect(client.DisplayClear.mock.calls).toStrictEqual([
      [{ application_name: 'demo', element_ids: ['extra', 'more'] }, options],
      [{ application_name: 'demo', element_ids: ['extra'] }, options],
      [{ application_name: 'demo', element_ids: ['extra', 'more'] }, options],
      [{ application_name: 'demo' }],
    ]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[demo] Deleting stale elements from the BUSY Bar failed:',
      new Error('bar offline'),
    );
  });

  it('remembers what the last draw that went through showed', async () => {
    const controller = new AbortController();
    let calls = 0;
    const client = fakeClient(controller, 3, () => {
      calls += 1;
      return calls === 2
        ? Promise.reject(new Error('bar offline'))
        : Promise.resolve();
    });
    const extra = {
      id: 'extra',
      type: 'text',
      text: 'X',
      font: 'small',
    } as const;
    let frame = 0;

    await runBarApp({
      name: 'demo',
      client,
      render: () => {
        frame += 1;
        return frame === 1 ? [...FRAME, extra] : FRAME;
      },
      intervalMs: 0,
      signal: controller.signal,
      log: { warn: vi.fn<(...data: unknown[]) => void>() },
    });

    expect(client.DisplayClear).toHaveBeenNthCalledWith(
      1,
      { application_name: 'demo', element_ids: ['extra'] },
      { signal: controller.signal },
    );
    expect(client.DisplayClear).toHaveBeenCalledTimes(2);
  });

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
