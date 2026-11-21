import { describe, expect, it, vi } from 'vitest';

import type { BarDisplayClient } from './run-bar-app.ts';
import { ON_SCREEN_MS, trackScreen } from './screen.ts';

function bar() {
  const client = {
    DisplayDraw: vi.fn<BarDisplayClient['DisplayDraw']>(() =>
      Promise.resolve({ result: 'OK' }),
    ),
    DisplayClear: vi.fn<BarDisplayClient['DisplayClear']>(() =>
      Promise.resolve({ result: 'OK' }),
    ),
  };
  const clock = { now: 1000 };
  return { client, clock, screen: trackScreen(client, () => clock.now) };
}

const FRAME = { application_name: 'demo', elements: [] };

describe('trackScreen', () => {
  it('is on screen for a while after a frame draws', async () => {
    const { clock, screen } = bar();

    expect(screen.onScreen()).toBe(false);

    await screen.client.DisplayDraw(FRAME);

    expect(screen.onScreen()).toBe(true);

    clock.now += ON_SCREEN_MS + 1;

    expect(screen.onScreen()).toBe(false);
  });

  it('is off screen once the bar refuses a frame', async () => {
    const { client, screen } = bar();
    await screen.client.DisplayDraw(FRAME);
    client.DisplayDraw.mockRejectedValueOnce(new Error('409'));

    await expect(screen.client.DisplayDraw(FRAME)).rejects.toThrow('409');
    expect(screen.onScreen()).toBe(false);
  });

  it('passes draws and clears through', async () => {
    const { client, screen } = bar();
    const options = { signal: new AbortController().signal };

    await screen.client.DisplayDraw(FRAME, options);
    await screen.client.DisplayClear({ application_name: 'demo' }, options);

    expect(client.DisplayDraw).toHaveBeenCalledWith(FRAME, options);
    expect(client.DisplayClear).toHaveBeenCalledWith(
      { application_name: 'demo' },
      options,
    );
  });
});
