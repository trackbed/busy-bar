import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

import type { AssetRoot } from '../__tests__/asset-root.ts';
import {
  assetRoot,
  STOCK_ANIMATION,
  STOCK_SOUND,
} from '../__tests__/asset-root.ts';
import { rawPcmSound } from '../formats/sound.ts';
import { ApiError } from './api-error.ts';
import { DEFAULT_SETTINGS, INITIAL_SNAPSHOT } from './busy-timer.ts';
import type { DeviceEvent, InputEvent, Key } from './device.ts';
import { Device } from './device.ts';
import type { AssetSource } from './elements.ts';
import { HOLD_MS, IDLE_PRIORITY, TIMER_PRIORITY } from './screen.ts';

const START = 1_700_000_000_000;
const TEXT = { id: 'hello', type: 'text', text: 'Hi', font: 'small' };
// The fixture's stock sound plays for 100 ms.
const BEEP: AssetSource = { kind: 'stock', path: `shared/${STOCK_SOUND}.snd` };

let fixture: AssetRoot;

beforeAll(async () => {
  fixture = await assetRoot();
});

afterAll(async () => {
  await fixture.cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup(root: AssetRoot = fixture) {
  const clock = { now: START };
  const device = new Device(await root.open(), () => clock.now);
  const events: DeviceEvent[] = [];
  device.on((event) => {
    events.push(event);
  });
  return { device, clock, events };
}

/** A draw request from "clock" showing one text, plus any fields. */
function body(fields: Readonly<Record<string, unknown>> = {}) {
  return { application_name: 'clock', elements: [TEXT], ...fields };
}

/** A draw's outcome without leaving a rejection unhandled meanwhile. */
function settle(drawing: Promise<void>): Promise<unknown> {
  return drawing.then(
    () => 'drawn',
    (error: unknown) => error,
  );
}

describe('Device', () => {
  describe('draw', () => {
    it('draws a valid request and reports the change', async () => {
      const { device, events } = await setup();
      await device.draw(body());

      expect(device.screen.owner).toStrictEqual({ app: 'clock', priority: 50 });
      expect(
        device.screen.elements().map((placed) => placed.element.id),
      ).toStrictEqual(['hello']);
      expect(events).toStrictEqual([{ type: 'changed' }]);
    });

    it('refuses an invalid request with the parser 400', async () => {
      const { device, events } = await setup();

      await expect(device.draw({ elements: [TEXT] })).rejects.toThrow(
        new ApiError(400, 'Missing application_name'),
      );
      expect(events).toStrictEqual([]);
    });

    it('checks images against its asset library', async () => {
      const { device } = await setup();
      const image = (stockPath: string, display = 'front') =>
        body({
          elements: [
            { id: 'pic', type: 'image', stock_path: stockPath, display },
          ],
        });

      await expect(
        device.draw(image('shared/wide_80x4.image')),
      ).rejects.toThrow(
        new ApiError(
          400,
          'elements[0]: image /ext/apps_assets/shared/images/wide_80x4.image exceeds display dimensions 72x16.',
        ),
      );
      await expect(device.draw(image('shared/missing.image'))).rejects.toThrow(
        new ApiError(
          400,
          'elements[0]: failed to decode image /ext/apps_assets/shared/images/missing.image',
        ),
      );
      await expect(
        device.draw(image('shared/wide_80x4.image', 'back')),
      ).resolves.toBeUndefined();
    });

    it('blinks the LED after a draw that names a colour', async () => {
      const { device, events } = await setup();
      await device.draw(body({ led_notification_color: '#00FF0080' }));

      expect(events).toStrictEqual([
        { type: 'changed' },
        { type: 'led', color: { r: 0, g: 255, b: 0, a: 128 } },
      ]);
    });

    it('does not blink the LED when the canvas refuses the draw', async () => {
      const { device, events } = await setup();

      await expect(
        device.draw(
          body({
            led_notification_color: '#00FF0080',
            elements: [{ ...TEXT, display_until: '1' }],
          }),
        ),
      ).rejects.toThrow(new ApiError(400, 'Nothing to display'));
      expect(events).toStrictEqual([]);
    });

    it('loads an animation before drawing it', async () => {
      const { device } = await setup();
      await device.draw(
        body({
          elements: [
            {
              id: 'spin',
              type: 'animation',
              stock_path: `shared/${STOCK_ANIMATION}.anim`,
              section: 'green',
            },
          ],
        }),
      );
      const player = device.screen.elements()[0]?.player;

      expect(player?.path).toBe(
        `/ext/apps_assets/shared/animations/${STOCK_ANIMATION}.anim`,
      );
      expect(player?.animation?.frames).toHaveLength(2);
      // The green section, the second frame, shows at once.
      expect(player?.frameIndex).toBe(1);
      expect(
        Array.from(player?.frame?.rgba.subarray(0, 4) ?? []),
      ).toStrictEqual([0, 255, 0, 255]);
    });

    it('draws an animation it cannot load without frames', async () => {
      const { device } = await setup();
      await device.draw(
        body({
          elements: [
            {
              id: 'spin',
              type: 'animation',
              stock_path: 'shared/missing.anim',
            },
          ],
        }),
      );
      const player = device.screen.elements()[0]?.player;

      expect(player?.animation).toBeUndefined();
      expect(player?.frameIndex).toBe(-1);
    });

    it('answers 409 when another app keeps the screen through the hold', async () => {
      const { device, events } = await setup();
      await device.draw(body({ application_name: 'news', priority: 80 }));
      vi.useFakeTimers();
      const outcome = settle(
        device.draw(body({ led_notification_color: '#FF0000FF' })),
      );
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(await outcome).toStrictEqual(
        new ApiError(409, 'Not drawn due to low priority'),
      );
      expect(device.screen.owner?.app).toBe('news');
      expect(events).toStrictEqual([{ type: 'changed' }]);
    });

    it('answers 409 to every draw while the BUSY timer runs', async () => {
      const { device } = await setup();
      device.setTimerRunning(true);
      vi.useFakeTimers();
      const outcome = settle(device.draw(body({ priority: 100 })));
      await vi.advanceTimersByTimeAsync(HOLD_MS);

      expect(await outcome).toStrictEqual(
        new ApiError(409, 'Not drawn due to low priority'),
      );
    });

    it('draws a held request once the BUSY timer stops within the hold', async () => {
      const { device, events } = await setup();
      vi.useFakeTimers();
      device.setTimerRunning(true);
      const outcome = settle(
        device.draw(body({ led_notification_color: '#FF0000FF' })),
      );
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
      device.setTimerRunning(false);

      expect(await outcome).toBe('drawn');
      expect(device.screen.owner).toStrictEqual({ app: 'clock', priority: 50 });
      expect(events).toStrictEqual([
        { type: 'settings' },
        { type: 'changed' },
        { type: 'settings' },
        { type: 'led', color: { r: 255, g: 0, b: 0, a: 255 } },
      ]);
    });
  });

  describe('press', () => {
    const button = (name: 'ok' | 'back' | 'start'): InputEvent[] => [
      { kind: 'button', button: name, action: 'press' },
      { kind: 'button', button: name, action: 'release' },
    ];

    it.each<[Key, InputEvent[]]>([
      ['up', [{ kind: 'wheel', delta: 1 }]],
      ['down', [{ kind: 'wheel', delta: -1 }]],
      ['ok', button('ok')],
      ['back', button('back')],
      ['start', button('start')],
      ['busy', [{ kind: 'selector', position: 'busy' }]],
      ['custom', [{ kind: 'selector', position: 'custom' }]],
      ['off', [{ kind: 'selector', position: 'off' }]],
      ['apps', [{ kind: 'selector', position: 'apps' }]],
      ['settings', [{ kind: 'selector', position: 'settings' }]],
    ])('reports %s as input', async (key, inputs) => {
      const { device, events } = await setup();
      device.press(key);

      expect(events).toStrictEqual(
        inputs.map((event) => ({ type: 'input', event })),
      );
    });

    it.each(['back', 'busy', 'custom', 'off', 'apps', 'settings'] as const)(
      'closes the canvas on %s',
      async (key) => {
        const { device, events } = await setup();
        await device.draw(body());
        device.press(key);

        expect(device.screen.owner).toBeUndefined();
        expect(events.filter((event) => event.type === 'changed')).toHaveLength(
          2,
        );
      },
    );

    it.each(['up', 'down', 'ok', 'start'] as const)(
      'keeps the canvas open on %s',
      async (key) => {
        const { device } = await setup();
        await device.draw(body());
        device.press(key);

        expect(device.screen.owner).toStrictEqual({
          app: 'clock',
          priority: 50,
        });
      },
    );
  });

  describe('settings', () => {
    it('starts with the bar defaults', async () => {
      const { device } = await setup();

      expect(device.brightness).toBe('auto');
      expect(device.volume).toBe(50);
      expect(device.name).toBe('BUSY Bar Emulator');
      expect(device.timerRunning).toBe(false);
      expect(device.screen.loaderPriority).toBe(IDLE_PRIORITY);
    });

    it('holds the screen above every app while the BUSY timer runs', async () => {
      const { device, events } = await setup();
      await device.draw(body({ priority: 100 }));
      device.setTimerRunning(true);

      expect(device.timerRunning).toBe(true);
      expect(device.screen.loaderPriority).toBe(TIMER_PRIORITY);
      expect(device.screen.owner).toBeUndefined();
      expect(events).toStrictEqual([
        { type: 'changed' },
        { type: 'changed' },
        { type: 'settings' },
      ]);

      device.setTimerRunning(false);

      expect(device.timerRunning).toBe(false);
      expect(device.screen.loaderPriority).toBe(IDLE_PRIORITY);
      expect(events.at(-1)).toStrictEqual({ type: 'settings' });
    });

    it('reports brightness, name, and silent volume changes', async () => {
      const { device, events } = await setup();
      device.setBrightness(40);
      device.setName('Desk');
      await device.setVolume(30, true);

      expect(device.brightness).toBe(40);
      expect(device.name).toBe('Desk');
      expect(device.volume).toBe(30);

      device.setBrightness('auto');

      expect(device.brightness).toBe('auto');
      expect(events).toStrictEqual([
        { type: 'settings' },
        { type: 'settings' },
        { type: 'settings' },
        { type: 'settings' },
      ]);
    });

    it('shrugs off a missing volume sound', async () => {
      const { device, events } = await setup();
      await device.setVolume(70, false);

      expect(device.volume).toBe(70);
      expect(events).toStrictEqual([{ type: 'settings' }]);
    });

    it('plays the stock volume sound unless silent', async () => {
      const root = await assetRoot();
      onTestFinished(() => root.cleanup());
      await writeFile(
        join(root.root, 'assets/shared/sounds/volume_change.wav'),
        rawPcmSound(new Uint8Array(4410)).wav,
      );
      const { device, events } = await setup(root);
      await device.setVolume(70, false);

      expect(events).toStrictEqual([
        { type: 'settings' },
        { type: 'sound', id: '1', durationMs: 50 },
      ]);

      await device.setVolume(60, true);

      expect(events).toHaveLength(3);
    });
  });

  describe('sounds', () => {
    it('plays sounds under increasing ids', async () => {
      const { device, events } = await setup();
      await device.play('clock', BEEP);
      await device.play('clock', BEEP);

      expect(events).toStrictEqual([
        { type: 'sound', id: '1', durationMs: 100 },
        { type: 'sound', id: '2', durationMs: 100 },
      ]);
      expect(device.sound('1')?.durationMs).toBe(100);
      expect(device.sound('3')).toBeUndefined();
    });

    it('plays an upload as raw PCM', async () => {
      const { device, events } = await setup();
      device.assets.upload('clock', 'tone.pcm', new Uint8Array(8820));
      await device.play('clock', { kind: 'path', path: 'tone.pcm' });

      expect(events).toStrictEqual([
        { type: 'sound', id: '1', durationMs: 100 },
      ]);
    });

    it('answers 404 for a sound the bar cannot find', async () => {
      const { device, events } = await setup();
      const missing = new ApiError(404, 'Failed to play audio');

      await expect(
        device.play('clock', { kind: 'stock', path: 'shared/missing.snd' }),
      ).rejects.toThrow(missing);
      await expect(
        device.play('clock', { kind: 'path', path: 'tone.pcm' }),
      ).rejects.toThrow(missing);
      expect(events).toStrictEqual([]);
    });

    it('keeps the last 16 sounds', async () => {
      const { device } = await setup();
      for (let count = 0; count < 17; count += 1) {
        await device.play('clock', BEEP);
      }

      expect(device.sound('1')).toBeUndefined();
      expect(device.sound('2')).toBeDefined();
      expect(device.sound('17')).toBeDefined();
    });

    it('stops a playing sound and answers 410 when none plays', async () => {
      const { device, clock, events } = await setup();
      const silent = new ApiError(410, 'No audio is playing');

      expect(() => {
        device.stopSound();
      }).toThrow(silent);

      await device.play('clock', BEEP);
      clock.now += 99;
      device.stopSound();

      expect(events.at(-1)).toStrictEqual({ type: 'silence' });
      expect(() => {
        device.stopSound();
      }).toThrow(silent);

      // A sound that played out leaves nothing to stop.
      await device.play('clock', BEEP);
      clock.now += 100;

      expect(() => {
        device.stopSound();
      }).toThrow(silent);
    });
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const device = new Device(await fixture.open());
    const listener = vi.fn<(event: DeviceEvent) => void>();
    const stop = device.on(listener);
    device.setName('A');
    stop();
    device.setName('B');

    expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'settings' });
  });

  describe('BUSY timer', () => {
    const CARD = 'c0ffee00-0000-4000-8000-00000000abcd';
    const simple = (at: number, leftMs: number, paused = false) => ({
      snapshot: {
        type: 'SIMPLE',
        card_id: CARD,
        is_paused: paused,
        time_left_ms: leftMs,
        busy_bar_settings: { ...DEFAULT_SETTINGS, theme: 'on_air' },
      },
      snapshot_timestamp_ms: at,
    });

    it('starts as a bar that never ran its timer', async () => {
      const { device } = await setup();

      expect(device.busySnapshot).toStrictEqual(INITIAL_SNAPSHOT);
    });

    it('records the switch starting and stopping an infinite timer', async () => {
      const { device, clock } = await setup();
      device.setBusySnapshot(simple(START, 60_000));
      clock.now += 1000;

      device.setTimerRunning(true);

      expect(device.busySnapshot).toStrictEqual({
        snapshot: {
          type: 'INFINITE',
          card_id: '00000000-0000-0000-0000-000000000000',
          is_paused: false,
          busy_bar_settings: { ...DEFAULT_SETTINGS, theme: 'on_air' },
        },
        snapshot_timestamp_ms: START + 1000,
      });

      clock.now += 1000;
      device.setTimerRunning(false);

      expect(device.busySnapshot).toStrictEqual({
        snapshot: {
          type: 'NOT_STARTED',
          busy_bar_settings: { ...DEFAULT_SETTINGS, theme: 'on_air' },
        },
        snapshot_timestamp_ms: START + 2000,
      });
      expect(device.timerRunning).toBe(false);
    });

    it('runs a newer snapshot and ignores an older one', async () => {
      const { device, events } = await setup();
      device.setBusySnapshot(simple(START, 60_000));

      expect(device.timerRunning).toBe(true);
      expect(device.screen.loaderPriority).toBe(TIMER_PRIORITY);

      device.setBusySnapshot({
        snapshot: { type: 'NOT_STARTED' },
        snapshot_timestamp_ms: START,
      });

      expect(device.busySnapshot).toStrictEqual(simple(START, 60_000));
      expect(events).toStrictEqual([{ type: 'settings' }]);
    });

    it('refuses a snapshot it cannot parse', async () => {
      const { device } = await setup();

      expect(() => {
        device.setBusySnapshot({ snapshot: { type: 'SIMPLE' } });
      }).toThrow(new ApiError(400, 'Failed to parse snapshot'));
      expect(device.busySnapshot).toStrictEqual(INITIAL_SNAPSHOT);
    });

    it('frees the screen when the timer runs out, keeping its snapshot', async () => {
      vi.useFakeTimers();
      const { device, events } = await setup();
      device.setBusySnapshot(simple(START, 60_000));

      vi.advanceTimersByTime(59_999);

      expect(device.timerRunning).toBe(true);

      vi.advanceTimersByTime(1);

      expect(device.timerRunning).toBe(false);
      expect(device.screen.loaderPriority).toBe(IDLE_PRIORITY);
      expect(device.busySnapshot).toStrictEqual(simple(START, 60_000));
      expect(events).toStrictEqual([
        { type: 'settings' },
        { type: 'settings' },
      ]);
    });

    it('does not run a timer that ran out before it arrived', async () => {
      const { device } = await setup();

      device.setBusySnapshot(simple(START - 2000, 1000));

      expect(device.timerRunning).toBe(false);
    });

    it('holds the screen while the timer is paused', async () => {
      vi.useFakeTimers();
      const { device } = await setup();
      device.setBusySnapshot(simple(START, 1000, true));

      vi.advanceTimersByTime(60_000);

      expect(device.timerRunning).toBe(true);
    });

    it('frees the screen at once for a stopped timer stamped ahead', async () => {
      const { device } = await setup();
      device.setBusySnapshot(simple(START, 60_000));
      device.setBusySnapshot({
        snapshot: { type: 'NOT_STARTED' },
        snapshot_timestamp_ms: START + 30_000,
      });

      expect(device.timerRunning).toBe(false);
      expect(device.screen.loaderPriority).toBe(IDLE_PRIORITY);
      // Drawn at once: a refused draw would wait out the hold.
      await device.draw(body());
      expect(device.screen.owner).toStrictEqual({ app: 'clock', priority: 50 });
    });

    it('counts a timer stamped ahead of the clock from now', async () => {
      vi.useFakeTimers();
      const { device } = await setup();
      device.setBusySnapshot(simple(START + 30_000, 60_000));

      vi.advanceTimersByTime(59_999);

      expect(device.timerRunning).toBe(true);

      vi.advanceTimersByTime(1);

      expect(device.timerRunning).toBe(false);
    });

    it('forgets the end of a timer that a new snapshot replaced', async () => {
      vi.useFakeTimers();
      const { device } = await setup();
      device.setBusySnapshot(simple(START, 1000));
      device.setTimerRunning(true);

      vi.advanceTimersByTime(60_000);

      expect(device.timerRunning).toBe(true);
    });
  });
});
