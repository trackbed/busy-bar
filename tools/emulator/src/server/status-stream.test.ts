import { once } from 'node:events';
import type { Server } from 'node:http';
import { createServer, request } from 'node:http';
import { connect as connectTcp } from 'node:net';
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
import { encodeRle } from '../formats/rle.ts';
import {
  encodeFrameState,
  encodeHeartbeat,
  encodeInputState,
  encodeSnapshot,
  encodeTooManyClients,
} from './protobuf.ts';
import {
  FRAME_INTERVAL_MS,
  HEARTBEAT_MS,
  MAX_CLIENTS,
  StatusStream,
} from './status-stream.ts';
import { encodeFrame } from './websocket.ts';

const START = 1_760_961_600_000;

let root: AssetRoot;
let library: AssetLibrary;

beforeAll(async () => {
  root = await assetRoot();
  library = await root.open();
});

afterAll(async () => {
  await root.cleanup();
});

interface Client {
  readonly socket: WebSocket;
  /** Every binary message, in order. */
  readonly messages: Uint8Array[];
  readonly closed: Promise<void>;
}

let now: number;
let device: Device;
let front: Uint8Array;
let stream: StatusStream;
let server: Server;
let port: number;
/** Bytes the clients have put on the wire, and the server has read. */
let sent: number;
let received: number;
let clients: Client[];

beforeEach(async () => {
  // The heartbeat runs on fake time; frames and sockets on real time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  now = START;
  device = new Device(library, () => now);
  front = Uint8Array.from({ length: 72 * 16 * 3 }, (_, i) => (i >> 6) & 0xff);
  stream = new StatusStream({ device, front: () => front, now: () => now });
  sent = 0;
  received = 0;
  clients = [];
  server = createServer();
  server.on('upgrade', (upgrade, socket) => {
    stream.accept(upgrade, socket);
    socket.on('data', (chunk: Uint8Array) => {
      received += chunk.length;
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server has no port.');
  }
  port = address.port;
});

afterEach(async () => {
  stream.close();
  await Promise.all(clients.map((client) => client.closed));
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  vi.useRealTimers();
});

async function connect(): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/status/ws`);
  socket.binaryType = 'arraybuffer';
  const messages: Uint8Array[] = [];
  socket.addEventListener('message', (event) => {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) {
      messages.push(new Uint8Array(data));
    }
  });
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener('close', () => {
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('The WebSocket did not open.'));
    });
  });
  const client = { socket, messages, closed };
  clients.push(client);
  return client;
}

function send(client: Client, data: string | Uint8Array): void {
  const length =
    typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  // A masked frame with a short payload: two header bytes and the mask.
  expect(length).toBeLessThan(126);
  sent += 6 + length;
  client.socket.send(typeof data === 'string' ? data : Uint8Array.from(data));
}

/** Send `value` as JSON text and wait until the server has read it all. */
async function deliver(client: Client, value: unknown): Promise<void> {
  send(client, JSON.stringify(value));
  await until(() => received >= sent, 'the server to read every message');
}

/** A client that has enabled the stream, its first snapshot read. */
async function subscribe(): Promise<Client> {
  const client = await connect();
  send(client, JSON.stringify({ enable: true, send: 'all' }));
  await until(() => client.messages.length === 1, 'the first snapshot');
  client.messages.length = 0;
  return client;
}

/**
 * Everything `client` was sent before now: it asks for a snapshot, which
 * arrives after anything sent earlier and is left out. The clock moves a
 * millisecond first, so no earlier message can pass for it.
 */
async function drain(client: Client): Promise<Uint8Array[]> {
  now += 1;
  const marker = snapshot();
  const at = (): number =>
    client.messages.findIndex((message) => same(message, marker));
  send(client, JSON.stringify({ enable: true, send: 'all' }));
  await until(() => at() !== -1, 'a snapshot');
  return client.messages.slice(0, at());
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function snapshot(): Uint8Array {
  return encodeSnapshot(
    {
      name: device.name,
      brightness: device.brightness,
      volume: device.volume,
    },
    encodeRle(front, 3),
    now,
  );
}

function frame(at: number): Uint8Array {
  return encodeFrameState(encodeRle(front, 3), at);
}

describe('StatusStream', () => {
  it('sends a snapshot to a client that enables the stream and asks', async () => {
    const client = await connect();

    await deliver(client, { enable: true });
    send(client, JSON.stringify({ send: 'all' }));
    await until(() => client.messages.length === 1, 'the snapshot');

    expect(client.messages).toStrictEqual([snapshot()]);
    expect(stream.size).toBe(1);
  });

  it('sends nothing to a client that has not subscribed', async () => {
    const quiet = await connect();

    await deliver(quiet, { send: 'all' });
    device.press('ok');
    device.setBrightness(40);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    stream.frameChanged();

    expect(await drain(quiet)).toStrictEqual([]);
  });

  it('stops sending to a client that unsubscribes', async () => {
    const leaving = await subscribe();

    await deliver(leaving, { enable: false });
    device.press('ok');
    device.setBrightness(40);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    stream.frameChanged();

    expect(await drain(leaving)).toStrictEqual([]);
  });

  it('ignores messages it cannot read', async () => {
    const client = await connect();

    send(client, Uint8Array.from([1, 2, 3]));
    send(client, '{"enable": tru');
    for (const value of [null, 'enable', ['enable'], { enable: 'yes' }]) {
      send(client, JSON.stringify(value));
    }
    await deliver(client, { send: 'all' });

    expect(client.messages).toStrictEqual([]);
    expect(await drain(client)).toStrictEqual([]);
    expect(stream.size).toBe(1);
  });

  it('broadcasts input events to every subscribed client', async () => {
    const first = await subscribe();
    const second = await subscribe();

    device.press('ok');
    device.press('down');
    device.press('apps');

    const expected = [
      encodeInputState(
        { kind: 'button', button: 'ok', action: 'press' },
        START,
      ),
      encodeInputState(
        { kind: 'button', button: 'ok', action: 'release' },
        START,
      ),
      encodeInputState({ kind: 'wheel', delta: -1 }, START),
      encodeInputState({ kind: 'selector', position: 'apps' }, START),
    ];
    expect(await drain(first)).toStrictEqual(expected);
    expect(await drain(second)).toStrictEqual(expected);
  });

  it('broadcasts a snapshot when a setting changes', async () => {
    const client = await subscribe();

    now += 5;
    device.setBrightness(40);
    const bright = snapshot();
    now += 5;
    device.setName('Desk bar');
    const named = snapshot();

    expect(await drain(client)).toStrictEqual([bright, named]);
  });

  it(`sends a heartbeat every ${HEARTBEAT_MS} ms`, async () => {
    const client = await subscribe();

    vi.advanceTimersByTime(HEARTBEAT_MS - 1);
    expect(await drain(client)).toStrictEqual([]);
    client.messages.length = 0;
    now += HEARTBEAT_MS;
    vi.advanceTimersByTime(1);
    const heartbeat = encodeHeartbeat(now);

    expect(await drain(client)).toStrictEqual([heartbeat]);
  });

  it(`sends a changed frame at once, then at most every ${FRAME_INTERVAL_MS} ms`, async () => {
    const client = await subscribe();

    front.fill(7);
    stream.frameChanged();
    const first = frame(START);
    await until(() => client.messages.length === 1, 'the first frame');

    now = START + 40;
    front.fill(9);
    stream.frameChanged();
    front.fill(11);
    stream.frameChanged();
    // The coalesced frame goes out when the interval is up, as it is then.
    now = START + FRAME_INTERVAL_MS;
    const second = frame(now);
    await until(() => client.messages.length === 2, 'the second frame');

    now = START + 250;
    stream.frameChanged();
    const third = frame(now);

    expect(await drain(client)).toStrictEqual([first, second, third]);
  });

  it(`turns a client past the first ${MAX_CLIENTS} away with an error`, async () => {
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      await connect();
    }

    const turnedAway = await connect();
    await turnedAway.closed;

    expect(turnedAway.messages).toStrictEqual([encodeTooManyClients(START)]);
    expect(stream.size).toBe(MAX_CLIENTS);
  });

  it('forgets a client whose socket closes', async () => {
    const leaving = await connect();
    const staying = await subscribe();

    leaving.socket.close();
    await leaving.closed;
    await until(() => stream.size === 1, 'the server to drop the client');

    device.press('up');
    expect(await drain(staying)).toStrictEqual([
      encodeInputState({ kind: 'wheel', delta: 1 }, START),
    ]);
  });

  it('serves nothing to a turned-away client that asks anyway', async () => {
    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      await connect();
    }
    // Half-open, so it can still write once the server has ended its side.
    const socket = connectTcp({ port, host: '127.0.0.1', allowHalfOpen: true });
    const replies: Uint8Array[] = [];
    socket.on('data', (chunk: Uint8Array) => {
      replies.push(chunk);
    });
    const reply = (): Buffer => Buffer.concat(replies);
    const close = encodeFrame('close', Uint8Array.from([0x03, 0xe8]));
    try {
      await once(socket, 'connect');
      socket.write(
        [
          'GET /api/status/ws HTTP/1.1',
          'Host: 127.0.0.1',
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
      await until(
        () => reply().subarray(-close.length).equals(close),
        'the server to close the connection',
      );
      // A text frame with an all-zero mask, so its payload reads as is.
      const ask = Buffer.from(JSON.stringify({ enable: true, send: 'all' }));
      const target = received + 6 + ask.length;
      socket.write(
        Buffer.concat([
          Buffer.from([0x81, 0x80 | ask.length, 0, 0, 0, 0]),
          ask,
        ]),
      );
      await until(() => received >= target, 'the server to read the request');

      const answer = reply();
      expect(answer.subarray(answer.indexOf('\r\n\r\n') + 4)).toStrictEqual(
        Buffer.concat([
          encodeFrame('binary', encodeTooManyClients(START)),
          close,
        ]),
      );
      expect(stream.size).toBe(MAX_CLIENTS);
    } finally {
      socket.destroy();
    }
  });

  it('passes over the device events the bar does not stream', async () => {
    const client = await subscribe();

    await device.draw({
      application_name: 'app',
      led_notification_color: '#FF0000FF',
      elements: [{ id: 'box', type: 'rectangle', width: 2, height: 2 }],
    });
    await device.play('app', { kind: 'stock', path: 'shared/beep.snd' });
    device.stopSound();

    expect(await drain(client)).toStrictEqual([]);
  });

  it('stamps messages with the wall clock by default', async () => {
    stream.close();
    stream = new StatusStream({ device, front: () => front });
    const client = await subscribe();

    const before = Date.now();
    vi.advanceTimersByTime(HEARTBEAT_MS);
    const after = Date.now();
    await until(() => client.messages.length === 1, 'a heartbeat');

    const [heartbeat = new Uint8Array(0)] = client.messages;
    // The fixed64 timestamp follows the tag byte, little-endian.
    const stamp = Number(
      new DataView(heartbeat.buffer, heartbeat.byteOffset).getBigUint64(
        1,
        true,
      ),
    );
    expect(heartbeat).toStrictEqual(encodeHeartbeat(stamp));
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });

  it('refuses an upgrade that is not a WebSocket handshake', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upgrade = request({
        host: '127.0.0.1',
        port,
        path: '/api/status/ws',
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      });
      upgrade.on('response', (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      upgrade.on('error', reject);
      upgrade.end();
    });

    expect(status).toBe(400);
    expect(stream.size).toBe(0);
  });

  it('closes every client and stops its timers when it closes', async () => {
    const subscribed = await subscribe();
    const idle = await connect();
    stream.frameChanged();
    await until(() => subscribed.messages.length === 1, 'a frame');
    stream.frameChanged();

    stream.close();
    await Promise.all([subscribed.closed, idle.closed]);
    device.press('ok');

    expect(stream.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(subscribed.messages).toStrictEqual([frame(START)]);
    expect(idle.messages).toStrictEqual([]);
  });
});
