import { writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { AssetRoot } from '../__tests__/asset-root.ts';
import { assetRoot } from '../__tests__/asset-root.ts';
import { solidPng } from '../__tests__/fixtures.ts';
import type { AssetLibrary } from '../assets/library.ts';
import type { DeviceEvent } from '../device/device.ts';
import { Device } from '../device/device.ts';
import { rawPcmSound } from '../formats/sound.ts';
import type { ApiContext } from './api.ts';
import { API_SEMVER, handleApi } from './api.ts';
import { ApiError, sendError } from './http.ts';

/** 2025-10-20T12:00:00Z. */
const STARTED_AT = 1_760_961_600_000;
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

let root: AssetRoot;
let library: AssetLibrary;
let server: Server;
let base: string;
let context: ApiContext;
let device: Device;
let events: DeviceEvent[];
let front: Uint8Array;
let back: Uint8Array;

beforeAll(async () => {
  root = await assetRoot();
  // The sound the bar plays when its volume changes.
  await writeFile(
    join(root.root, 'assets/shared/sounds/volume_change.wav'),
    rawPcmSound(new Uint8Array(4410)).wav,
  );
  library = await root.open();
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://bar.local');
    handleApi(request, response, url, context).catch((error: unknown) => {
      sendError(response, new ApiError(500, String(error)));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server has no port.');
  }
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await root.cleanup();
});

beforeEach(() => {
  device = new Device(library, () => STARTED_AT);
  events = [];
  device.on((event) => {
    events.push(event);
  });
  front = Uint8Array.from({ length: 72 * 16 * 3 }, (_, i) => i % 251);
  back = Uint8Array.from({ length: 160 * 80 }, (_, i) => (i * 37) % 256);
  context = {
    device,
    screen: { front: () => front, back: () => back },
    startedAt: STARTED_AT,
    firmwareCommit: COMMIT,
  };
});

interface Answer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** The body as JSON, or undefined when it is not JSON. */
  readonly body: unknown;
}

async function call(
  method: string,
  path: string,
  init: {
    readonly body?: string | Uint8Array;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    body:
      init.body instanceof Uint8Array
        ? Uint8Array.from(init.body)
        : (init.body ?? null),
    headers: init.headers ?? {},
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    text,
    body: json(text),
  };
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const OK = { result: 'OK' };

function error(message: string): { error: string } {
  return { error: message };
}

function rect(id: string): Record<string, unknown> {
  return {
    id,
    type: 'rectangle',
    width: 2,
    height: 2,
    fill: 'solid',
    fill_colors: ['#FF0000FF'],
  };
}

function drawing(
  application: string,
  elements: readonly unknown[],
  extra: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({ application_name: application, elements, ...extra });
}

/** Put `ids` on screen for `application`, as a draw does. */
async function show(
  application: string,
  ids: readonly string[],
): Promise<void> {
  await device.draw({ application_name: application, elements: ids.map(rect) });
}

function onScreen(): string[] {
  return device.screen.elements().map((placed) => placed.element.id);
}

describe('handleApi', () => {
  it('answers a CORS preflight on any path', async () => {
    const answer = await call('OPTIONS', '/api/display/draw');

    expect(answer.status).toBe(200);
    expect(answer.text).toBe('');
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(answer.headers.get('access-control-allow-headers')).toBe('*');
    expect(answer.headers.get('access-control-allow-methods')).toBe(
      'GET, POST, PUT, DELETE, OPTIONS',
    );
  });

  it("answers JSON with the bar's CORS headers", async () => {
    const answer = await call('GET', '/api/version');

    expect(answer.status).toBe(200);
    expect(answer.body).toStrictEqual({ api_semver: '27.14.0' });
    expect(answer.headers.get('content-type')).toBe('application/json');
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(answer.headers.get('access-control-allow-headers')).toBe('*');
  });

  it.each(['27.14.0', '27.0.1', '27.x.y', '27', '027.1.0'])(
    'takes the X-API-Sem-Ver %j of the same major version',
    async (version) => {
      const answer = await call('GET', '/api/display/brightness', {
        headers: { 'x-api-sem-ver': version },
      });

      expect(answer.status).toBe(200);
    },
  );

  it.each(['', 'abc', '.27', '27x.1', 'v27.1.0', '256.0.0'])(
    'refuses the unreadable X-API-Sem-Ver %j with 400',
    async (version) => {
      const answer = await call('GET', '/api/display/brightness', {
        headers: { 'x-api-sem-ver': version },
      });

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Bad Request'));
    },
  );

  it.each(['26.9.9', '28.0.0', '255.0.0'])(
    'refuses the X-API-Sem-Ver %j of another major version with 405',
    async (version) => {
      const answer = await call('GET', '/api/display/brightness', {
        headers: { 'x-api-sem-ver': version },
      });

      expect(answer.status).toBe(405);
      expect(answer.body).toStrictEqual(error('Incompatible API version'));
    },
  );

  it('answers /api/version whatever version the client sends', async () => {
    for (const version of ['1.0.0', 'junk']) {
      const answer = await call('GET', '/api/version', {
        headers: { 'x-api-sem-ver': version },
      });

      expect(answer.body).toStrictEqual({ api_semver: API_SEMVER });
    }
  });

  it.each(['/api/nothing', '/api/', '/api/display/draw/', '/api/status/x'])(
    'answers 400 for the unknown path %s',
    async (path) => {
      const answer = await call('GET', path);

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Bad Request'));
    },
  );

  it.each([
    ['GET', '/api/display/draw', 'POST, DELETE'],
    ['POST', '/api/version', 'GET'],
    ['PUT', '/api/audio/volume', 'GET, POST'],
    ['PATCH', '/api/assets/upload', 'POST, DELETE'],
    ['DELETE', '/api/screen', 'GET'],
    ['POST', '/api/busy/snapshot', 'GET, PUT'],
  ])('answers %s %s with 405, allowing %s', async (method, path, allow) => {
    const answer = await call(method, path);

    expect(answer.status).toBe(405);
    expect(answer.body).toStrictEqual(error('Method Not Allowed'));
    expect(answer.headers.get('allow')).toBe(allow);
  });

  it('leaves failures that are not API errors to the server', async () => {
    device.on(() => {
      throw new Error('listener failed');
    });

    const answer = await call('POST', '/api/input?key=up');

    expect(answer.status).toBe(500);
    expect(answer.body).toStrictEqual(error('Error: listener failed'));
  });
});

describe('GET /api/status', () => {
  // 1 day, 2 hours, 3 minutes and 4.5 seconds after the start.
  const UPTIME_MS = 93_784_500;

  const STATUS = {
    device: {
      serial_number: 'EMULATOR',
      usb_mac: '00:00:00:00:00:00',
      otp_valid: false,
      firmware_security: 'unknown',
    },
    firmware: {
      version: 'emulator',
      target: 0,
      branch: 'emulator',
      build_date: '2025-10-20',
      commit_hash: '01234567',
      intercom_version: '0',
      matter_version: '1.0',
    },
    system: {
      api_semver: '27.14.0',
      // Like the firmware, the hours keep counting past a day.
      uptime: '01d 26h 03m 04s',
      boot_time: STARTED_AT / 1000,
      auto_update_enabled: false,
    },
    power: {
      state: 'charged',
      battery_charge: 100,
      battery_voltage: 4200,
      battery_current: 0,
      usb_voltage: 5000,
    },
  };

  it('reports the device, firmware, system, and power', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(STARTED_AT + UPTIME_MS);

    const answer = await call('GET', '/api/status');

    expect(answer.status).toBe(200);
    expect(answer.body).toStrictEqual(STATUS);
  });

  it.each(['device', 'firmware', 'system', 'power'] as const)(
    'reports the %s part alone',
    async (part) => {
      vi.spyOn(Date, 'now').mockReturnValue(STARTED_AT + UPTIME_MS);

      const answer = await call('GET', `/api/status/${part}`);

      expect(answer.body).toStrictEqual(STATUS[part]);
    },
  );
});

describe('POST /api/display/draw', () => {
  it('draws a valid request and answers OK', async () => {
    const answer = await call('POST', '/api/display/draw', {
      body: drawing('app', [rect('a'), rect('b')], { priority: 70 }),
    });

    expect(answer.status).toBe(200);
    expect(answer.body).toStrictEqual(OK);
    expect(device.screen.owner).toStrictEqual({ app: 'app', priority: 70 });
    expect(onScreen()).toStrictEqual(['a', 'b']);
  });

  it.each(['', 'not json', '{"application_name": "app"'])(
    'reads the body %j, which is not JSON, as one without fields',
    async (body) => {
      const answer = await call('POST', '/api/display/draw', { body });

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Missing application_name'));
    },
  );

  it.each([
    [drawing('app', []), 'Elements array is empty'],
    [drawing('app', [rect('a')], { priority: 0 }), 'Priority must be >= 1'],
    [drawing('app', [{ type: 'text' }]), 'elements[0].id is required'],
  ])('answers the invalid draw %s with 400', async (body, message) => {
    const answer = await call('POST', '/api/display/draw', { body });

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error(message));
    expect(device.screen.owner).toBeUndefined();
  });

  it('answers 409 when the screen stays taken', async () => {
    const draws = vi.spyOn(device.screen, 'draw');
    // While the BUSY timer runs, the loader holds the screen above every app.
    device.setTimerRunning(true);

    const first = call('POST', '/api/display/draw', {
      body: drawing('first', [rect('a')]),
    });
    await vi.waitFor(() => {
      expect(draws).toHaveBeenCalledTimes(1);
    });
    // A newer refused draw ends the wait of the one before it.
    const second = call('POST', '/api/display/draw', {
      body: drawing('second', [rect('a')]),
    });
    const refused = await first;
    device.setTimerRunning(false);
    const drawn = await second;

    expect(refused.status).toBe(409);
    expect(refused.body).toStrictEqual(error('Not drawn due to low priority'));
    expect(drawn.body).toStrictEqual(OK);
    expect(device.screen.owner?.app).toBe('second');
  });

  it('refuses a body over 1 MiB with 413', async () => {
    const answer = await call('POST', '/api/display/draw', {
      body: ' '.repeat(1024 * 1024 + 1),
    });

    expect(answer.status).toBe(413);
    expect(answer.body).toStrictEqual(
      error('Request body larger than 1048576 bytes.'),
    );
  });
});

describe('DELETE /api/display/draw', () => {
  it('clears the screen without a body, drawn on or not', async () => {
    expect((await call('DELETE', '/api/display/draw')).body).toStrictEqual(OK);

    await show('app', ['a', 'b']);
    const answer = await call('DELETE', '/api/display/draw');

    expect(answer.body).toStrictEqual(OK);
    expect(device.screen.owner).toBeUndefined();
  });

  it.each([
    ['{', 'body contains malformed JSON'],
    ['[]', 'body JSON must be an object'],
    ['null', 'body JSON must be an object'],
    ['"app"', 'body JSON must be an object'],
    ['{"element_ids": "a"}', 'element_ids must be an array of strings'],
    ['{"element_ids": ["a", 1]}', 'element_ids must be an array of strings'],
    ['{"element_ids": null}', 'element_ids must be an array of strings'],
    [
      '{"application_name": 1, "element_ids": 1}',
      'element_ids must be an array of strings',
    ],
    ['{"application_name": 1}', 'application_name must be a string'],
    ['{"application_name": null}', 'application_name must be a string'],
  ])('refuses the body %s with 400', async (body, message) => {
    await show('app', ['a']);

    const answer = await call('DELETE', '/api/display/draw', { body });

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error(message));
    expect(onScreen()).toStrictEqual(['a']);
  });

  it('refuses an application name in both the query and the body', async () => {
    await show('app', ['a']);

    const answer = await call(
      'DELETE',
      `/api/display/draw?application_name=${'a'.repeat(63)}`,
      {
        body: '{"application_name": "app"}',
      },
    );

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(
      error(
        'application_name present in both the body and query parameters; exactly one is required',
      ),
    );
  });

  it.each(['', 'a'.repeat(64)])(
    'ignores the query name %j, as the bar does',
    async (query) => {
      await show('app', ['a']);

      const answer = await call(
        'DELETE',
        `/api/display/draw?application_name=${query}`,
        { body: '{"application_name": "app"}' },
      );

      expect(answer.body).toStrictEqual(OK);
      expect(device.screen.owner).toBeUndefined();
    },
  );

  it('deletes only the named elements of the app that shows them', async () => {
    await show('app', ['a', 'b']);

    const first = await call('DELETE', '/api/display/draw', {
      body: '{"element_ids": ["a"]}',
    });

    expect(first.body).toStrictEqual(OK);
    expect(onScreen()).toStrictEqual(['b']);

    const last = await call(
      'DELETE',
      '/api/display/draw?application_name=app',
      {
        body: '{"element_ids": ["b"]}',
      },
    );

    expect(last.body).toStrictEqual(OK);
    expect(device.screen.owner).toBeUndefined();
  });

  it.each([
    [
      '?application_name=other',
      '',
      'this application_name is currently not displaying anything',
    ],
    [
      '',
      '{"application_name": "other"}',
      'this application_name is currently not displaying anything',
    ],
    ['', '{"element_ids": ["zzz"]}', 'one of element_ids is non-existent'],
  ])(
    'refuses %s %s while another app shows its elements',
    async (query, body, message) => {
      await show('app', ['a']);

      const answer = await call('DELETE', `/api/display/draw${query}`, {
        body,
      });

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error(message));
      expect(onScreen()).toStrictEqual(['a']);
    },
  );

  it('refuses element ids while nothing is on screen', async () => {
    const answer = await call('DELETE', '/api/display/draw', {
      body: '{"element_ids": []}',
    });

    expect(answer.body).toStrictEqual(
      error('one of element_ids is non-existent'),
    );
  });
});

describe('/api/display/brightness', () => {
  it('reports and sets the brightness', async () => {
    const value = async (): Promise<unknown> =>
      (await call('GET', '/api/display/brightness')).body;

    expect(await value()).toStrictEqual({ value: 'auto' });

    expect(
      (await call('POST', '/api/display/brightness?value=40')).body,
    ).toStrictEqual(OK);
    expect(await value()).toStrictEqual({ value: '40' });

    await call('POST', '/api/display/brightness?value=0100');
    expect(await value()).toStrictEqual({ value: '100' });

    await call('POST', '/api/display/brightness?value=auto');
    expect(await value()).toStrictEqual({ value: 'auto' });
    expect(events.filter((event) => event.type === 'settings')).toHaveLength(3);
  });

  it.each([
    '',
    '?value=',
    '?value=101',
    '?value=-1',
    '?value=4.5',
    '?value=abc',
    '?value=AUTO',
    '?value=00001',
    '?brightness=40',
  ])('refuses %j with 400', async (query) => {
    const answer = await call('POST', `/api/display/brightness${query}`);

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error('Bad Request'));
    expect(device.brightness).toBe('auto');
  });
});

describe('/api/audio/play', () => {
  function sounds(): DeviceEvent[] {
    return events.filter((event) => event.type === 'sound');
  }

  it('plays a stock sound found by the basename of its path', async () => {
    const answer = await call('POST', '/api/audio/play', {
      body: '{"application_name": "app", "stock_path": "any/folder/beep.snd"}',
    });

    expect(answer.body).toStrictEqual(OK);
    expect(sounds()).toStrictEqual([
      { type: 'sound', id: '1', durationMs: 100 },
    ]);
  });

  it("plays an upload from the app's own folder", async () => {
    library.upload('player', 'sounds/click.raw', new Uint8Array(4410));

    const answer = await call('POST', '/api/audio/play', {
      body: '{"application_name": "player", "path": "sounds/click.raw"}',
    });

    expect(answer.body).toStrictEqual(OK);
    expect(sounds()).toStrictEqual([
      { type: 'sound', id: '1', durationMs: 50 },
    ]);
    library.deleteUploads('player');
  });

  it.each([
    '{"application_name": "app", "stock_path": "shared/missing.snd"}',
    '{"application_name": "app", "stock_path": "shared/beep.wav"}',
    '{"application_name": "app", "path": "missing.raw"}',
  ])('answers 404 for the file %s that it cannot find', async (body) => {
    const answer = await call('POST', '/api/audio/play', { body });

    expect(answer.status).toBe(404);
    expect(answer.body).toStrictEqual(error('Failed to play audio'));
  });

  it.each([
    ['not JSON', 'nope', 'Missing application_name'],
    ['an array', '["app"]', 'Missing application_name'],
    ['no name', '{"stock_path": "a/b.snd"}', 'Missing application_name'],
    [
      'a name that is not a string',
      '{"application_name": 1, "stock_path": "a/b.snd"}',
      'Missing application_name',
    ],
    [
      'both paths',
      '{"application_name": "app", "path": "a.raw", "stock_path": "a/b.snd"}',
      'Both path and stock_path are defined',
    ],
    [
      'neither path',
      '{"application_name": "app"}',
      'Missing path or stock_path',
    ],
    [
      'a path that is not a string',
      '{"application_name": "app", "path": 5}',
      'Missing path or stock_path',
    ],
    [
      'a path out of the app folder',
      '{"application_name": "app", "path": "../other/a.raw"}',
      'Invalid path',
    ],
    [
      'a folder starting with two dots',
      '{"application_name": "app", "path": "a/..b/c.raw"}',
      'Invalid path',
    ],
    [
      'a stock path without a folder',
      '{"application_name": "app", "stock_path": "beep.snd"}',
      'Wrong file name',
    ],
    [
      'a stock path without a file',
      '{"application_name": "app", "stock_path": "shared/"}',
      'Wrong file name',
    ],
  ])('refuses %s with 400', async (_name, body, message) => {
    const answer = await call('POST', '/api/audio/play', { body });

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error(message));
    expect(sounds()).toStrictEqual([]);
  });

  it('stops the sound that plays, or answers 410', async () => {
    const stop = async (): Promise<Answer> => call('DELETE', '/api/audio/play');

    const idle = await stop();
    await call('POST', '/api/audio/play', {
      body: '{"application_name": "app", "stock_path": "shared/beep.snd"}',
    });
    const stopped = await stop();
    const again = await stop();

    expect(idle.status).toBe(410);
    expect(idle.body).toStrictEqual(error('No audio is playing'));
    expect(stopped.body).toStrictEqual(OK);
    expect(again.status).toBe(410);
    expect(events.filter((event) => event.type === 'silence')).toHaveLength(1);
  });
});

describe('/api/audio/volume', () => {
  it('reports and sets the volume, with the volume sound unless silent', async () => {
    const volume = async (): Promise<unknown> =>
      (await call('GET', '/api/audio/volume')).body;

    expect(await volume()).toStrictEqual({ volume: 50 });

    expect(
      (await call('POST', '/api/audio/volume?volume=30')).body,
    ).toStrictEqual(OK);
    expect(await volume()).toStrictEqual({ volume: 30 });
    await call('POST', '/api/audio/volume?volume=0&silent=1');
    expect(await volume()).toStrictEqual({ volume: 0 });
    await call('POST', '/api/audio/volume?volume=0100&silent=0');
    expect(await volume()).toStrictEqual({ volume: 100 });

    expect(events.filter((event) => event.type === 'sound')).toHaveLength(2);
  });

  it.each([
    '',
    '?volume=',
    '?volume=101',
    '?volume=-5',
    '?volume=abc',
    '?volume=00050',
    '?silent=1',
    '?volume=50&silent=',
    '?volume=50&silent=2',
    '?volume=50&silent=10',
    '?volume=50&silent=true',
  ])('refuses %j with 400', async (query) => {
    const answer = await call('POST', `/api/audio/volume${query}`);

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error('Bad Request'));
    expect(device.volume).toBe(50);
  });
});

describe('/api/assets/upload', () => {
  const png = solidPng(2, 2, [0, 255, 0, 255]);

  it('stores an upload and closes the connection', async () => {
    const answer = await call(
      'POST',
      '/api/assets/upload?application_name=uploader&file=img/dot.png',
      { body: png },
    );

    expect(answer.body).toStrictEqual(OK);
    expect(answer.headers.get('connection')).toBe('close');
    expect(
      library.image({ kind: 'path', path: 'img/dot.png' }, 'uploader'),
    ).toMatchObject({ width: 2, height: 2 });
    library.deleteUploads('uploader');
  });

  it('takes the longest names the bar does, and files past 1 MiB', async () => {
    const application = `A-z_0.${'9'.repeat(25)}`;
    const file = `${'d'.repeat(30)}/${'f'.repeat(29)}.png`;

    const answer = await call(
      'POST',
      `/api/assets/upload?application_name=${application}&file=${file}`,
      { body: new Uint8Array(1024 * 1024 + 1) },
    );

    expect([application.length, file.length]).toStrictEqual([31, 64]);
    expect(answer.body).toStrictEqual(OK);
    library.deleteUploads(application);
  });

  it('refuses an upload over 16 MiB with 413', async () => {
    const answer = await call(
      'POST',
      '/api/assets/upload?application_name=uploader&file=big.bin',
      { body: new Uint8Array(16 * 1024 * 1024 + 1) },
    );

    expect(answer.status).toBe(413);
    expect(answer.body).toStrictEqual(
      error('Request body larger than 16777216 bytes.'),
    );
  });

  it.each([
    'file=a.png',
    'application_name=&file=a.png',
    `application_name=${'a'.repeat(32)}&file=a.png`,
    'application_name=my%20app&file=a.png',
    'application_name=my/app&file=a.png',
    'application_name=app',
    'application_name=app&file=',
    `application_name=app&file=${'f'.repeat(65)}`,
    'application_name=app&file=/a.png',
    'application_name=app&file=img/',
    'application_name=app&file=img//a.png',
    'application_name=app&file=a..png',
    'application_name=app&file=../a.png',
    'application_name=app&file=a%20b.png',
    'application_name=app&file=a%5Cb.png',
  ])('refuses the upload ?%s with 400', async (query) => {
    const answer = await call('POST', `/api/assets/upload?${query}`, {
      body: png,
    });

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error('Bad Request'));
  });

  it("deletes every upload of an app, and only that app's", async () => {
    library.upload('cleaner', 'a.png', png);
    library.upload('cleaner', 'img/b.png', png);
    library.upload('keeper', 'a.png', png);

    const answer = await call(
      'DELETE',
      '/api/assets/upload?application_name=cleaner',
    );

    expect(answer.body).toStrictEqual(OK);
    expect(
      library.image({ kind: 'path', path: 'a.png' }, 'cleaner'),
    ).toBeUndefined();
    expect(
      library.image({ kind: 'path', path: 'img/b.png' }, 'cleaner'),
    ).toBeUndefined();
    expect(
      library.image({ kind: 'path', path: 'a.png' }, 'keeper'),
    ).toBeDefined();
    library.deleteUploads('keeper');
  });

  it.each([
    '',
    '?application_name=',
    '?application_name=bad%20name',
    `?application_name=${'a'.repeat(32)}`,
  ])('refuses deleting uploads for %j with 400', async (query) => {
    const answer = await call('DELETE', `/api/assets/upload${query}`);

    expect(answer.status).toBe(400);
    expect(answer.body).toStrictEqual(error('Bad Request'));
  });
});

describe('GET /api/screen', () => {
  it('sends the front display as base64 of its B,G,R bytes', async () => {
    const answer = await call('GET', '/api/screen?display=0');

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/bmp');
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(answer.headers.get('access-control-allow-headers')).toBe('*');
    expect(answer.text).toBe(Buffer.from(front).toString('base64'));
  });

  it('sends the back display packed to four bits a pixel', async () => {
    back.set([0x12, 0x34, 0xff, 0x0f], 0);

    const answer = await call('GET', '/api/screen?display=1');
    const packed = Buffer.from(answer.text, 'base64');

    expect(answer.headers.get('content-type')).toBe('image/bmp');
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(packed).toHaveLength(6400);
    // The even pixel's top bits in the low nibble, the odd one's in the high.
    expect([...packed.subarray(0, 2)]).toStrictEqual([0x31, 0x0f]);
    expect(
      [...packed].every(
        (byte, i) =>
          byte ===
          (((back[i * 2] ?? 0) >> 4) | ((back[i * 2 + 1] ?? 0) & 0xf0)),
      ),
    ).toBe(true);
  });

  it.each(['', '?display=', '?display=2', '?display=00', '?display=front'])(
    'refuses %j with "Wrong display"',
    async (query) => {
      const answer = await call('GET', `/api/screen${query}`);

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Wrong display'));
    },
  );
});

describe('POST /api/input', () => {
  it('presses the key', async () => {
    const answer = await call('POST', '/api/input?key=ok');

    expect(answer.body).toStrictEqual(OK);
    expect(events).toStrictEqual([
      {
        type: 'input',
        event: { kind: 'button', button: 'ok', action: 'press' },
      },
      {
        type: 'input',
        event: { kind: 'button', button: 'ok', action: 'release' },
      },
    ]);
  });

  it('closes the app canvas for a key that leaves it', async () => {
    await show('app', ['a']);

    await call('POST', '/api/input?key=back');

    expect(device.screen.owner).toBeUndefined();
  });

  it.each(['', '?key=', '?key=OK', '?key=left', '?key=okay'])(
    'refuses %j with 400',
    async (query) => {
      const answer = await call('POST', `/api/input${query}`);

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Bad Request'));
      expect(events).toStrictEqual([]);
    },
  );
});

describe('/api/busy/snapshot', () => {
  const SIMPLE = {
    snapshot: {
      type: 'SIMPLE',
      card_id: 'c0ffee00-0000-4000-8000-00000000abcd',
      is_paused: false,
      time_left_ms: 1_500_000,
      busy_bar_settings: {
        theme: 'on_air',
        show_work_phase_only: false,
        trigger_smart_home: true,
      },
    },
    snapshot_timestamp_ms: STARTED_AT,
  };

  it('answers what a bar that never ran its timer reports', async () => {
    const answer = await call('GET', '/api/busy/snapshot');

    expect(answer.status).toBe(200);
    expect(answer.text).toBe(
      '{"snapshot":{"type":"NOT_STARTED","busy_bar_settings":{"theme":"busy","show_work_phase_only":false,"trigger_smart_home":true}},"snapshot_timestamp_ms":0}',
    );
  });

  it('runs the timer from the snapshot it is given', async () => {
    const put = await call('PUT', '/api/busy/snapshot', {
      body: JSON.stringify(SIMPLE),
    });

    expect(put.body).toStrictEqual(OK);
    expect(device.timerRunning).toBe(true);
    expect((await call('GET', '/api/busy/snapshot')).body).toStrictEqual(
      SIMPLE,
    );
  });

  it.each(['', 'snapshot', '[]', '{}', JSON.stringify(SIMPLE.snapshot)])(
    'refuses the body %j with 400',
    async (body) => {
      const answer = await call('PUT', '/api/busy/snapshot', { body });

      expect(answer.status).toBe(400);
      expect(answer.body).toStrictEqual(error('Failed to parse snapshot'));
      expect(device.timerRunning).toBe(false);
    },
  );
});
