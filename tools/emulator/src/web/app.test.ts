// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { webPage } from './__tests__/page.ts';

const IDLE = {
  loaderPriority: 9,
  elements: 0,
  timerRunning: false,
  brightness: 'auto',
  volume: 50,
};

let page: ReturnType<typeof webPage>;

beforeEach(async () => {
  vi.resetModules();
  page = webPage();
  await import('./app.ts');
});

afterEach(() => {
  page.cleanup();
});

describe('emulator page', () => {
  it('connects to the live stream and shows connection recovery', () => {
    expect(
      document.querySelector('script[type="module"]')?.getAttribute('src'),
    ).toBe('/app.ts');
    expect(page.connect).toHaveBeenCalledExactlyOnceWith('/emulator/events');
    expect(document.querySelector('#address')?.textContent).toBe(
      'BUSYBAR_ADDR=127.0.0.1:8080',
    );

    page.events.dispatchEvent(new Event('open'));
    expect(page.connection.textContent).toBe('live');
    expect(page.connection.classList.contains('live')).toBe(true);

    page.events.dispatchEvent(new Event('error'));
    expect(page.connection.textContent).toBe('reconnecting…');
    expect(page.connection.classList.contains('live')).toBe(false);

    page.events.dispatchEvent(new Event('open'));
    expect(page.connection.textContent).toBe('live');
    expect(page.connection.classList.contains('live')).toBe(true);
  });

  it('draws front RGB pixels as LEDs with the off threshold and display geometry', () => {
    page.send('frame', {
      front: Buffer.from([
        255, 0, 0, 0, 255, 0, 0, 0, 255, 30, 0, 0, 31, 0, 0,
      ]).toString('base64'),
      back: null,
    });

    expect(page.front.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 720, 160);
    expect(page.front.fills).toHaveLength(72 * 16);
    expect(page.front.fills.slice(0, 6)).toStrictEqual([
      'rgb(255 0 0)',
      'rgb(0 255 0)',
      'rgb(0 0 255)',
      '#111',
      'rgb(31 0 0)',
      '#111',
    ]);
    expect(page.front.roundRect).toHaveBeenNthCalledWith(
      1,
      0.75,
      0.75,
      8.5,
      8.5,
      2.125,
    );
    expect(page.front.roundRect).toHaveBeenLastCalledWith(
      710.75,
      150.75,
      8.5,
      8.5,
      2.125,
    );
    expect(page.back.drawImage).not.toHaveBeenCalled();
  });

  it('unpacks low nibbles first and converts all back-panel drive levels to sRGB', () => {
    page.send('frame', {
      front: null,
      back: Buffer.from([
        0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe,
      ]).toString('base64'),
    });

    const bitmap = page.bitmaps[0];
    const image = bitmap?.context.putImageData.mock.calls[0]?.[0];
    expect([bitmap?.width, bitmap?.height]).toStrictEqual([160, 80]);
    expect(Array.from(image?.data.subarray(0, 64) ?? [])).toStrictEqual(
      [
        0, 50, 71, 94, 111, 130, 146, 160, 175, 186, 199, 211, 224, 234, 246,
        255,
      ].flatMap((value) => [value, value, value, 255]),
    );
    expect(Array.from(image?.data.subarray(64, 68) ?? [])).toStrictEqual([
      0, 0, 0, 255,
    ]);
    expect(bitmap?.context.putImageData).toHaveBeenCalledWith(image, 0, 0);
    expect(page.back.imageSmoothingEnabled).toBe(false);
    expect(page.back.drawImage).toHaveBeenCalledExactlyOnceWith(
      bitmap,
      0,
      0,
      640,
      320,
    );
    expect(page.front.fill).not.toHaveBeenCalled();
  });

  it('draws both displays from one delivered frame', () => {
    page.send('frame', { front: '/wAA', back: '/w==' });

    expect(page.front.fills[0]).toBe('rgb(255 0 0)');
    expect(page.back.drawImage).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    [],
    42,
    {},
    { front: '' },
    { back: '' },
    { front: 42, back: false },
  ])('ignores incomplete or wrongly typed frames: %j', (value) => {
    page.send('frame', value);

    expect(page.front.fill).not.toHaveBeenCalled();
    expect(page.back.drawImage).not.toHaveBeenCalled();
  });

  it('ignores events without a string message body', () => {
    page.events.dispatchEvent(new Event('frame'));
    page.events.dispatchEvent(new MessageEvent('state', { data: IDLE }));

    expect(page.front.fill).not.toHaveBeenCalled();
    expect(page.state.children).toHaveLength(0);
  });

  it('shows idle state with optional owner fields absent', () => {
    page.send('state', IDLE);

    expect(
      [...page.state.querySelectorAll('dd')].map((row) => row.textContent),
    ).toStrictEqual(['none (canvas closed)', '-', '9', '0', 'auto', '50']);
    expect(page.timer.checked).toBe(false);
  });

  it('shows an active app, timer ownership, and manual brightness', () => {
    page.send('state', {
      application: 'clock',
      priority: 60,
      loaderPriority: 101,
      elements: 3,
      timerRunning: true,
      brightness: 30,
      volume: 20,
    });

    expect(
      [...page.state.querySelectorAll('dd')].map((row) => row.textContent),
    ).toStrictEqual(['clock', '60', '101 (BUSY timer)', '3', '30', '20']);
    expect(page.timer.checked).toBe(true);
  });

  it.each([
    'loaderPriority',
    'elements',
    'timerRunning',
    'brightness',
    'volume',
  ])('ignores state missing required field %s', (field) => {
    const state = Object.fromEntries(
      Object.entries(IDLE).filter(([key]) => key !== field),
    );
    page.send('state', state);

    expect(page.state.children).toHaveLength(0);
  });

  it.each([
    null,
    [],
    'state',
    { loaderPriority: 'bad', elements: null },
    { ...IDLE, application: 42 },
    { ...IDLE, priority: '60' },
    { ...IDLE, loaderPriority: '9' },
    { ...IDLE, elements: null },
    { ...IDLE, timerRunning: 1 },
    { ...IDLE, brightness: 'bright' },
    { ...IDLE, volume: '50' },
  ])('ignores state with the wrong field types: %j', (value) => {
    page.send('state', value);

    expect(page.state.children).toHaveLength(0);
  });

  it('ignores non-finite state numbers parsed from JSON', () => {
    page.events.dispatchEvent(
      new MessageEvent('state', {
        data: '{"loaderPriority":9,"elements":0,"timerRunning":false,"brightness":"auto","volume":1e309}',
      }),
    );

    expect(page.state.children).toHaveLength(0);
  });

  it('keeps the last valid state and audio volume after an invalid update', () => {
    page.send('state', IDLE);
    const previous = page.state.textContent;
    page.send('state', { ...IDLE, volume: null, timerRunning: true });
    page.sound.checked = true;
    page.send('sound', { url: '/emulator/sounds/1.wav' });

    expect(page.state.textContent).toBe(previous);
    expect(page.timer.checked).toBe(false);
    expect(page.sounds[0]?.volume).toBe(0.5);
  });

  it.each([
    'up',
    'down',
    'ok',
    'back',
    'start',
    'busy',
    'custom',
    'off',
    'apps',
    'settings',
  ])('sends the %s button through the device input API', (key) => {
    document
      .querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)
      ?.click();

    expect(page.request).toHaveBeenCalledExactlyOnceWith(
      `/api/input?key=${key}`,
      { method: 'POST' },
    );
  });

  it.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['Enter', 'ok'],
    ['Escape', 'back'],
    [' ', 'start'],
  ])('maps keyboard %s to device %s', (key, input) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(page.request).toHaveBeenCalledExactlyOnceWith(
      `/api/input?key=${input}`,
      { method: 'POST' },
    );
  });

  it('leaves unknown shortcuts and input-field keys to the browser', () => {
    const unknown = new KeyboardEvent('keydown', {
      key: 'a',
      cancelable: true,
    });
    const inInput = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(unknown);
    page.timer.dispatchEvent(inInput);

    expect(unknown.defaultPrevented).toBe(false);
    expect(inInput.defaultPrevented).toBe(false);
    expect(page.request).not.toHaveBeenCalled();
  });

  it.each([
    [-1, 'up'],
    [1, 'down'],
  ])('maps wheel delta %s to %s without scrolling the page', (deltaY, key) => {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true });
    page.wheel.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(page.request).toHaveBeenCalledExactlyOnceWith(
      `/api/input?key=${key}`,
      { method: 'POST' },
    );
  });

  it.each([true, false])('writes the timer switch state %s', (running) => {
    page.timer.checked = running;
    page.timer.dispatchEvent(new Event('change'));

    expect(page.request).toHaveBeenCalledExactlyOnceWith(
      `/emulator/timer?running=${running ? '1' : '0'}`,
      { method: 'POST' },
    );
  });

  it('silences the old sound before playing another at the reported volume', () => {
    page.sound.checked = true;
    page.send('state', { ...IDLE, volume: 20 });
    page.send('sound', { url: '/emulator/sounds/1.wav' });
    page.send('sound', { url: '/emulator/sounds/2.wav' });

    expect(page.sounds.map(({ url, volume }) => [url, volume])).toStrictEqual([
      ['/emulator/sounds/1.wav', 0.2],
      ['/emulator/sounds/2.wav', 0.2],
    ]);
    expect(page.play).toHaveBeenCalledTimes(2);
    expect(page.sounds[0]?.pause).toHaveBeenCalledOnce();
    expect(page.sounds[1]?.pause).not.toHaveBeenCalled();

    page.send('silence', null);
    expect(page.sounds[1]?.pause).toHaveBeenCalledOnce();
  });

  it('ignores sounds while disabled and silence when nothing is playing', () => {
    page.send('sound', { url: '/emulator/sounds/1.wav' });
    page.send('silence', null);

    expect(page.audio).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { url: 42 }])(
    'ignores wrongly typed sound events: %j',
    (value) => {
      page.sound.checked = true;
      page.send('sound', value);

      expect(page.audio).not.toHaveBeenCalled();
    },
  );

  it('tolerates playback rejected by browser autoplay policy', async () => {
    page.sound.checked = true;
    page.play.mockRejectedValueOnce(new Error('Autoplay blocked'));
    page.send('sound', { url: '/emulator/sounds/1.wav' });
    await Promise.resolve();

    expect(page.play).toHaveBeenCalledOnce();
  });

  it('blinks the LED three times for a delivered notification color', () => {
    page.send('led', { r: 10, g: 20, b: 30 });

    expect(page.animate).toHaveBeenCalledExactlyOnceWith(
      [
        { background: 'rgb(10 20 30)', boxShadow: '0 0 8px rgb(10 20 30)' },
        { background: '#333', boxShadow: 'none' },
      ],
      { duration: 400, iterations: 3 },
    );
  });

  it.each([
    null,
    {},
    { r: 1, g: 2 },
    { r: '1', g: 2, b: 3 },
    { r: 1, g: '2', b: 3 },
    { r: 1, g: 2, b: '3' },
  ])('ignores incomplete or wrongly typed LED events: %j', (value) => {
    page.send('led', value);

    expect(page.animate).not.toHaveBeenCalled();
  });
});
