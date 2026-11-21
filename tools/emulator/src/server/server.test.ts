import { request } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AssetRoot } from '../__tests__/asset-root.ts';
import { assetRoot } from '../__tests__/asset-root.ts';
import { until } from '../__tests__/until.ts';
import type { AssetLibrary } from '../assets/library.ts';
import { Device } from '../device/device.ts';
import { decodePng } from '../formats/png.ts';
import { encodeRle } from '../formats/rle.ts';
import { rawPcmSound } from '../formats/sound.ts';
import { SceneRenderer } from '../render/scene.ts';
import type { PageFile } from './page.ts';
import { encodeFrameState } from './protobuf.ts';
import { Emulator, REFRESH_MS } from './server.ts';

const START = 1_760_961_600_000;
const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const PAGE: ReadonlyMap<string, PageFile> = new Map([
  ['/', { contentType: 'text/html; charset=utf-8', body: '<!doctype html>' }],
  [
    '/app.ts',
    { contentType: 'text/javascript; charset=utf-8', body: 'export {};' },
  ],
]);
const IDLE = {
  loaderPriority: 9,
  elements: 0,
  timerRunning: false,
  brightness: 'auto',
  volume: 50,
};

let root: AssetRoot;
let library: AssetLibrary;

beforeAll(async () => {
  root = await assetRoot();
  library = await root.open();
});

afterAll(async () => {
  await root.cleanup();
});

let now: number;
let device: Device;
let emulator: Emulator;
let base: string;
let others: Emulator[];
let sockets: WebSocket[];

beforeEach(async () => {
  // The frame loop and the heartbeat run on fake time; sockets on real time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  now = START;
  device = new Device(library, () => now);
  others = [];
  sockets = [];
  emulator = create();
  base = await serve(emulator);
});

afterEach(async () => {
  for (const each of [emulator, ...others]) {
    await each.close();
  }
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
          } else {
            socket.addEventListener('close', () => {
              resolve();
            });
          }
        }),
    ),
  );
  vi.useRealTimers();
});

function create(page: ReadonlyMap<string, PageFile> = PAGE): Emulator {
  return new Emulator({
    device,
    renderer: new SceneRenderer(library),
    page,
    firmwareCommit: COMMIT,
    now: () => now,
  });
}

/** Serve without the frame loop, so tests tick by hand; the base URL. */
async function serve(served: Emulator): Promise<string> {
  await new Promise<void>((resolve) => {
    served.server.listen(0, '127.0.0.1', resolve);
  });
  const address = served.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server has no port.');
  }
  return `http://127.0.0.1:${address.port}`;
}

interface LiveEvent {
  readonly type: string;
  readonly data: unknown;
}

/** The page's event stream: each call to `next` reads one event. */
async function watch(origin = base): Promise<() => Promise<LiveEvent>> {
  const response = await fetch(`${origin}/emulator/events`);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  if (response.body === null) {
    throw new Error('The event stream has no body.');
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  return async () => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = /^event: (.+)$/mu.exec(block)?.[1];
        const data = /^data: (.+)$/mu.exec(block)?.[1];
        if (type !== undefined && data !== undefined) {
          const parsed: unknown = JSON.parse(data);
          return { type, data: parsed };
        }
        continue;
      }
      const { done, value } = await reader.read();
      if (done) {
        throw new Error('The event stream ended.');
      }
      buffer += value;
    }
  };
}

/** A status stream client that has subscribed and read its snapshot. */
async function subscribe(origin = base): Promise<Uint8Array[]> {
  const socket = new WebSocket(
    `${origin.replace('http', 'ws')}/api/status/ws?x-api-sem-ver=27.14.0`,
  );
  sockets.push(socket);
  socket.binaryType = 'arraybuffer';
  const messages: Uint8Array[] = [];
  socket.addEventListener('message', (event) => {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) {
      messages.push(new Uint8Array(data));
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('The WebSocket did not open.'));
    });
  });
  socket.send(JSON.stringify({ enable: true, send: 'all' }));
  await until(() => messages.length === 1, 'the snapshot');
  messages.length = 0;
  return messages;
}

async function get(path: string, method = 'GET'): Promise<Response> {
  return fetch(`${base}${path}`, { method });
}

async function screen(display: 0 | 1): Promise<Buffer> {
  const response = await get(`/api/screen?display=${display}`);
  return Buffer.from(await response.text(), 'base64');
}

async function draw(
  elements: readonly Record<string, unknown>[],
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await device.draw({ application_name: 'app', elements, ...extra });
}

function rect(fields: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'rect',
    type: 'rectangle',
    width: 2,
    height: 2,
    fill: 'solid',
    fill_colors: ['#FF0000FF'],
    border_width: 0,
    ...fields,
  };
}

/** RGB from the bar's B, G, R order, or back. */
function swapRedBlue(pixels: Uint8Array): Uint8Array {
  const out = Uint8Array.from(pixels);
  for (let i = 0; i < out.length; i += 3) {
    out.subarray(i, i + 3).reverse();
  }
  return out;
}

/** The status stream's frame for the front the API reports right now. */
async function frameState(at: number): Promise<Uint8Array> {
  return encodeFrameState(encodeRle(await screen(0), 3), at);
}

describe('Emulator', () => {
  it('serves the API, reading the screen from the last frame', async () => {
    const version = await get('/api/version');
    const firmware = await get('/api/status/firmware');

    expect(await version.json()).toStrictEqual({ api_semver: '27.14.0' });
    expect(await firmware.json()).toMatchObject({ commit_hash: 'fedcba98' });

    await draw([rect()]);
    expect([...(await screen(0)).subarray(0, 3)]).toStrictEqual([0, 0, 0]);

    emulator.tick();

    // B, G, R: red is its last byte.
    expect([...(await screen(0)).subarray(0, 3)]).toStrictEqual([0, 0, 255]);
  });

  it('reports its state for the page', async () => {
    expect(emulator.state()).toStrictEqual({
      ...IDLE,
      application: undefined,
      priority: undefined,
    });

    await draw([rect(), rect({ id: 'other', x: 4 })], { priority: 60 });
    device.setBrightness(30);
    await device.setVolume(20, true);

    expect(emulator.state()).toStrictEqual({
      application: 'app',
      priority: 60,
      loaderPriority: 9,
      elements: 2,
      timerRunning: false,
      brightness: 30,
      volume: 20,
    });
  });

  it('starts the event stream with its state and both displays', async () => {
    const next = await watch();

    expect(await next()).toStrictEqual({ type: 'state', data: IDLE });
    expect(await next()).toStrictEqual({
      type: 'frame',
      data: {
        // RGB, all black while the canvas is closed.
        front: Buffer.alloc(72 * 16 * 3).toString('base64'),
        // Four bits a pixel, as /api/screen sends the back.
        back: (await screen(1)).toString('base64'),
      },
    });
  });

  it('forwards what the device does to the page', async () => {
    const next = await watch();
    await next();
    await next();

    await draw([rect()], { led_notification_color: '#FF000080' });
    await get('/api/display/brightness?value=40', 'POST');
    await fetch(`${base}/api/audio/play`, {
      method: 'POST',
      body: '{"application_name": "app", "stock_path": "shared/beep.snd"}',
    });
    await get('/api/audio/play', 'DELETE');
    await get('/api/input?key=up', 'POST');

    expect(await next()).toStrictEqual({
      type: 'state',
      data: { ...IDLE, application: 'app', priority: 50, elements: 1 },
    });
    expect(await next()).toStrictEqual({
      type: 'led',
      data: { r: 255, g: 0, b: 0, a: 128 },
    });
    expect(await next()).toStrictEqual({
      type: 'state',
      data: {
        ...IDLE,
        application: 'app',
        priority: 50,
        elements: 1,
        brightness: 40,
      },
    });
    expect(await next()).toStrictEqual({
      type: 'sound',
      data: { url: '/emulator/sounds/1.wav', durationMs: 100 },
    });
    expect(await next()).toStrictEqual({ type: 'silence', data: null });
    expect(await next()).toStrictEqual({
      type: 'input',
      data: { kind: 'wheel', delta: 1 },
    });
  });

  it('pushes frames when a display changes, and the front to the status stream', async () => {
    const next = await watch();
    await next();
    await next();
    const stream = await subscribe();

    emulator.tick();
    // Only the back changes: the page gets a frame, the status stream not.
    await draw([rect({ id: 'back', display: 'back' })]);
    expect(await next()).toMatchObject({ type: 'state' });
    emulator.tick();
    const backFrame = await next();
    const backOnly = (await screen(1)).toString('base64');
    await draw([rect({ id: 'back', display: 'back' }), rect()]);
    expect(await next()).toMatchObject({ type: 'state' });
    now += 50;
    emulator.tick();
    const frontFrame = await next();
    const expected = await frameState(now);
    await until(() => stream.length > 0, 'the status stream frame');

    expect(backFrame).toStrictEqual({
      type: 'frame',
      data: {
        front: Buffer.alloc(72 * 16 * 3).toString('base64'),
        back: backOnly,
      },
    });
    expect(frontFrame).toStrictEqual({
      type: 'frame',
      data: {
        front: Buffer.from(swapRedBlue(await screen(0))).toString('base64'),
        back: (await screen(1)).toString('base64'),
      },
    });
    expect(stream).toStrictEqual([expected]);
  });

  it('drops expired elements as it ticks', async () => {
    await draw([rect({ timeout: 1 })]);
    emulator.tick();
    expect(emulator.state().elements).toBe(1);

    now += 1000;
    emulator.tick();

    expect(emulator.state()).toMatchObject({
      application: undefined,
      elements: 0,
    });
    expect([...(await screen(0)).subarray(0, 3)]).toStrictEqual([0, 0, 0]);
  });

  it('runs and stops the BUSY timer for the page', async () => {
    await draw([rect()]);

    const running = await get('/emulator/timer?running=1', 'POST');
    const stopped = await get('/emulator/timer?running=0', 'POST');

    // The timer holds the screen above every app, closing the canvas.
    expect(await running.json()).toStrictEqual({
      ...IDLE,
      loaderPriority: 101,
      timerRunning: true,
    });
    expect(await stopped.json()).toStrictEqual(IDLE);
  });

  it.each(['', '?running=', '?running=2', '?running=true'])(
    'refuses to set the timer from %j',
    async (query) => {
      const answer = await get(`/emulator/timer${query}`, 'POST');

      expect(answer.status).toBe(400);
      expect(await answer.json()).toStrictEqual({
        error: 'running must be 0 or 1',
      });
      expect(device.timerRunning).toBe(false);
    },
  );

  it('takes screenshots of the front in colour', async () => {
    await draw([rect()]);
    emulator.tick();
    const bgr = await screen(0);

    const answer = await get('/emulator/screenshot.png');
    const plain = decodePng(new Uint8Array(await answer.arrayBuffer()));
    const scaled = decodePng(
      new Uint8Array(
        await (await get('/emulator/screenshot.png?scale=3')).arrayBuffer(),
      ),
    );

    const rgb = swapRedBlue(bgr);
    const expected = new Uint8Array(72 * 16 * 4);
    for (let pixel = 0; pixel < 72 * 16; pixel += 1) {
      expected.set([...rgb.subarray(pixel * 3, pixel * 3 + 3), 255], pixel * 4);
    }

    expect(answer.headers.get('content-type')).toBe('image/png');
    expect([plain.width, plain.height]).toStrictEqual([72, 16]);
    expect(plain.rgba).toStrictEqual(expected);
    expect([scaled.width, scaled.height]).toStrictEqual([216, 48]);
    const at = (x: number, y: number): number[] => [
      ...scaled.rgba.subarray((y * 216 + x) * 4, (y * 216 + x) * 4 + 4),
    ];
    expect(at(5, 5)).toStrictEqual([255, 0, 0, 255]);
    expect(at(6, 0)).toStrictEqual([0, 0, 0, 255]);
  });

  it('takes screenshots of the back at its 16 grey levels', async () => {
    await draw([rect()]);
    emulator.tick();
    const packed = await screen(1);

    const shot = decodePng(
      new Uint8Array(
        await (
          await get('/emulator/screenshot.png?display=back&scale=2')
        ).arrayBuffer(),
      ),
    );

    // Each pixel of the shot shows the level the API reports, out of 15.
    const levels = Array.from({ length: 160 * 80 }, (_, pixel) => {
      const byte = packed[pixel >> 1] ?? 0;
      return (pixel % 2 === 0 ? byte & 0x0f : byte >> 4) * 17;
    });
    const shown = Array.from({ length: 160 * 80 }, (_, pixel) => {
      const at =
        ((Math.floor(pixel / 160) * 2 + 1) * 320 + (pixel % 160) * 2) * 4;
      return [...shot.rgba.subarray(at, at + 4)];
    });

    expect([shot.width, shot.height]).toStrictEqual([320, 160]);
    expect(shown).toStrictEqual(
      levels.map((level) => [level, level, level, 255]),
    );
    expect(levels).toContain(255);
    expect(levels.some((level) => level > 0 && level < 255)).toBe(true);
  });

  it.each([
    '?display=side',
    '?scale=0',
    '?scale=17',
    '?scale=1.5',
    '?scale=big',
    '?scale=',
  ])('refuses the screenshot %s', async (query) => {
    const answer = await get(`/emulator/screenshot.png${query}`);

    expect(answer.status).toBe(400);
    expect(await answer.json()).toStrictEqual({
      error: 'Use display=front|back and scale=1..16',
    });
  });

  it('takes the largest screenshot it allows', async () => {
    const shot = decodePng(
      new Uint8Array(
        await (await get('/emulator/screenshot.png?scale=16')).arrayBuffer(),
      ),
    );

    expect([shot.width, shot.height]).toStrictEqual([1152, 256]);
  });

  it('serves the sounds the page was told to play', async () => {
    await device.play('app', { kind: 'stock', path: 'shared/beep.snd' });

    const sound = await get('/emulator/sounds/1.wav');
    const unknown = await get('/emulator/sounds/2.wav');

    expect(sound.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await sound.arrayBuffer())).toStrictEqual(
      rawPcmSound(new Uint8Array(8820)).wav,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toStrictEqual({ error: 'No such sound' });
  });

  it('serves the page files, on GET only', async () => {
    const index = await get('/');
    const script = await get('/app.ts?v=1');

    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toBe('<!doctype html>');
    expect(script.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(await script.text()).toBe('export {};');
    for (const [path, method] of [
      ['/', 'POST'],
      ['/missing.html', 'GET'],
      ['/emulator/sounds/x.wav', 'GET'],
      ['/emulator/timer?running=1', 'GET'],
    ] as const) {
      const answer = await get(path, method);

      expect(answer.status).toBe(404);
      expect(await answer.json()).toStrictEqual({ error: 'Not found' });
    }
  });

  it('hands the status stream its upgrades and refuses the others', async () => {
    const stream = await subscribe();
    device.setBrightness(10);
    await until(() => stream.length === 1, 'the settings snapshot');

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upgrade = request(`${base}/api/other`, {
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      });
      upgrade.on('response', (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      upgrade.on('error', reject);
      upgrade.end();
    });

    expect(status).toBe(404);
  });

  it('answers 500 when it fails, and logs why', async () => {
    const failure = new Error('The page store broke.');
    const broken = create(
      new (class extends Map<string, PageFile> {
        override get(): PageFile | undefined {
          throw failure;
        }
      })(),
    );
    others.push(broken);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {
      // Keep the expected failure out of the test output.
    });

    const answer = await fetch(`${await serve(broken)}/index.html`);

    expect(answer.status).toBe(500);
    expect(await answer.json()).toStrictEqual({
      error: 'Internal emulator error',
    });
    expect(logged).toHaveBeenCalledWith(failure);
  });

  it('keeps to the wall clock without a clock of its own', async () => {
    const before = Math.floor(Date.now() / 1000);
    const clocked = new Emulator({
      device,
      renderer: new SceneRenderer(library),
      page: PAGE,
      firmwareCommit: COMMIT,
    });
    const after = Math.floor(Date.now() / 1000);
    others.push(clocked);

    const answer = await fetch(`${await serve(clocked)}/api/status/system`);
    const system: unknown = await answer.json();

    expect(system).toHaveProperty('boot_time');
    expect([before, after]).toContain(
      typeof system === 'object' && system !== null && 'boot_time' in system
        ? system.boot_time
        : undefined,
    );
  });

  it(`listens on a port and renders every ${REFRESH_MS} ms`, async () => {
    const running = create();
    others.push(running);

    const port = await running.listen(0, '127.0.0.1');
    const next = await watch(`http://127.0.0.1:${port}`);
    await next();
    await next();
    await draw([rect()]);
    await next();
    vi.advanceTimersByTime(REFRESH_MS);

    expect(port).toBeGreaterThan(0);
    expect(await next()).toMatchObject({ type: 'frame' });
  });

  it('fails to listen on a port in use', async () => {
    const second = create();
    others.push(second);

    await expect(
      second.listen(Number(new URL(base).port), '127.0.0.1'),
    ).rejects.toThrow('EADDRINUSE');
  });

  it('closes its event streams, status clients, and server', async () => {
    const next = await watch();
    await next();
    await next();
    await subscribe();
    const [socket] = sockets;

    await emulator.close();

    await expect(next()).rejects.toThrow('The event stream ended.');
    await until(
      () => socket?.readyState === WebSocket.CLOSED,
      'the socket to close',
    );
    await expect(get('/api/version')).rejects.toThrow('fetch failed');
  });
});
