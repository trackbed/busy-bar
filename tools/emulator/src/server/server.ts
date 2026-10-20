// The emulator's HTTP server: the bar's API under /api, its status stream,
// and the page that shows both displays, fed by a frame loop that renders
// at the firmware's display refresh rate.

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

import type { Device, DeviceEvent } from '../device/device.ts';
import { encodePng } from '../formats/png.ts';
import type { Canvas } from '../render/canvas.ts';
import type { SceneRenderer } from '../render/scene.ts';
import type { ApiContext } from './api.ts';
import { handleApi, packGrey4 } from './api.ts';
import { ApiError, sendBytes, sendError, sendJson } from './http.ts';
import { LiveChannel } from './live.ts';
import type { PageFile } from './page.ts';
import { StatusStream } from './status-stream.ts';

/** LVGL redraws the displays every 16 ms (LV_DEF_REFR_PERIOD). */
export const REFRESH_MS = 16;

export interface EmulatorOptions {
  readonly device: Device;
  readonly renderer: SceneRenderer;
  readonly page: ReadonlyMap<string, PageFile>;
  readonly firmwareCommit: string;
  readonly now?: () => number;
}

/** What the page shows next to the displays. */
export interface EmulatorState {
  readonly application: string | undefined;
  readonly priority: number | undefined;
  readonly loaderPriority: number;
  readonly elements: number;
  readonly timerRunning: boolean;
  readonly brightness: 'auto' | number;
  readonly volume: number;
}

export class Emulator {
  readonly server: Server;
  readonly #device: Device;
  readonly #renderer: SceneRenderer;
  readonly #page: ReadonlyMap<string, PageFile>;
  readonly #now: () => number;
  readonly #api: ApiContext;
  readonly #live = new LiveChannel();
  readonly #stream: StatusStream;
  #front: Canvas;
  #back: Canvas;
  #loop: ReturnType<typeof setInterval> | undefined;

  constructor(options: EmulatorOptions) {
    this.#device = options.device;
    this.#renderer = options.renderer;
    this.#page = options.page;
    this.#now = options.now ?? Date.now;
    ({ front: this.#front, back: this.#back } = this.#render());
    this.#api = {
      device: this.#device,
      screen: { front: () => bgr(this.#front), back: () => this.#back.pixels },
      startedAt: this.#now(),
      firmwareCommit: options.firmwareCommit,
    };
    this.#stream = new StatusStream({
      device: this.#device,
      front: () => bgr(this.#front),
      now: this.#now,
    });
    this.#device.on((event) => {
      this.#forward(event);
    });
    this.server = createServer((request, response) => {
      this.#handle(request, response).catch((error: unknown) => {
        console.error(error);
        if (!response.headersSent) {
          sendError(response, new ApiError(500, 'Internal emulator error'));
        }
      });
    });
    this.server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
      this.#upgrade(request, socket);
    });
  }

  /** Start serving and rendering; resolves with the port it listens on. */
  async listen(port: number, host: string): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.#loop = setInterval(() => {
      this.tick();
    }, REFRESH_MS);
    const address = this.server.address();
    return typeof address === 'object' && address !== null
      ? (address satisfies AddressInfo).port
      : port;
  }

  async close(): Promise<void> {
    clearInterval(this.#loop);
    this.#stream.close();
    this.#live.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  /** Advance the screen one refresh and push what changed. */
  tick(): void {
    this.#device.screen.tick();
    const { front, back } = this.#render();
    const frontChanged = !equal(front.pixels, this.#front.pixels);
    const backChanged = !equal(back.pixels, this.#back.pixels);
    this.#front = front;
    this.#back = back;
    if (frontChanged) {
      this.#stream.frameChanged();
    }
    if (frontChanged || backChanged) {
      this.#live.send({ type: 'frame', data: this.#frame() });
    }
  }

  /** The page's view of the device. */
  state(): EmulatorState {
    const { screen } = this.#device;
    return {
      application: screen.owner?.app,
      priority: screen.owner?.priority,
      loaderPriority: screen.loaderPriority,
      elements: screen.elements().length,
      timerRunning: this.#device.timerRunning,
      brightness: this.#device.brightness,
      volume: this.#device.volume,
    };
  }

  #render(): { front: Canvas; back: Canvas } {
    const { screen } = this.#device;
    return this.#renderer.render(
      { elements: screen.elements(), application: screen.owner?.app },
      this.#now(),
    );
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://emulator.local');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url, this.#api);
      return;
    }
    if (url.pathname === '/emulator/events') {
      this.#live.open(response, [
        { type: 'state', data: this.state() },
        { type: 'frame', data: this.#frame() },
      ]);
      return;
    }
    if (url.pathname === '/emulator/timer' && request.method === 'POST') {
      const running = url.searchParams.get('running');
      if (running !== '0' && running !== '1') {
        sendError(response, new ApiError(400, 'running must be 0 or 1'));
        return;
      }
      this.#device.setTimerRunning(running === '1');
      sendJson(response, 200, this.state());
      return;
    }
    if (url.pathname === '/emulator/screenshot.png') {
      this.#screenshot(url, response);
      return;
    }
    const sound = /^\/emulator\/sounds\/(\d+)\.wav$/u.exec(url.pathname)?.[1];
    if (sound !== undefined) {
      const found = this.#device.sound(sound);
      if (found === undefined) {
        sendError(response, new ApiError(404, 'No such sound'));
        return;
      }
      sendBytes(response, 'audio/wav', found.wav);
      return;
    }
    const file = this.#page.get(url.pathname);
    if (file === undefined || request.method !== 'GET') {
      sendError(response, new ApiError(404, 'Not found'));
      return;
    }
    sendBytes(response, file.contentType, file.body);
  }

  #upgrade(request: IncomingMessage, socket: Duplex): void {
    const path = new URL(request.url ?? '/', 'http://emulator.local').pathname;
    if (path === '/api/status/ws') {
      this.#stream.accept(request, socket);
      return;
    }
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  }

  /**
   * A PNG of one display, `scale` times its size: the front as RGB, the
   * back at the 16 grey levels its panel shows.
   */
  #screenshot(url: URL, response: ServerResponse): void {
    const display = url.searchParams.get('display') ?? 'front';
    const scale = Number(url.searchParams.get('scale') ?? '1');
    if (
      (display !== 'front' && display !== 'back') ||
      !Number.isInteger(scale) ||
      scale < 1 ||
      scale > 16
    ) {
      sendError(
        response,
        new ApiError(400, 'Use display=front|back and scale=1..16'),
      );
      return;
    }
    const canvas = display === 'front' ? this.#front : this.#back;
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = canvas.pixel(
          Math.floor(x / scale),
          Math.floor(y / scale),
        );
        const level = (value: number): number =>
          display === 'back' ? (value >> 4) * 17 : value;
        rgba.set(
          [level(color.r), level(color.g), level(color.b), 255],
          (y * width + x) * 4,
        );
      }
    }
    sendBytes(response, 'image/png', encodePng({ width, height, rgba }));
  }

  #frame(): { readonly front: string; readonly back: string } {
    return {
      front: Buffer.from(this.#front.pixels).toString('base64'),
      back: Buffer.from(packGrey4(this.#back.pixels)).toString('base64'),
    };
  }

  #forward(event: DeviceEvent): void {
    switch (event.type) {
      case 'changed':
      case 'settings':
        this.#live.send({ type: 'state', data: this.state() });
        break;
      case 'sound':
        this.#live.send({
          type: 'sound',
          data: {
            url: `/emulator/sounds/${event.id}.wav`,
            durationMs: event.durationMs,
          },
        });
        break;
      case 'silence':
        this.#live.send({ type: 'silence', data: null });
        break;
      case 'led':
        this.#live.send({ type: 'led', data: event.color });
        break;
      case 'input':
        this.#live.send({ type: 'input', data: event.event });
        break;
    }
  }
}

/** The front display's bytes as the bar keeps them: B, G, R. */
function bgr(front: Canvas): Uint8Array {
  const out = front.pixels.slice();
  for (let i = 0; i < out.length; i += 3) {
    out.subarray(i, i + 3).reverse();
  }
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
