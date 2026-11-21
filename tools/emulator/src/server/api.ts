// The bar's local HTTP API, answering like the firmware at the pinned commit
// (applications/services/web_server/http_api in the firmware): the same
// paths, methods, status codes, and error messages.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { isObject, stringAt } from '@busy-bar-apps/json-values';

import { ApiError } from '../device/api-error.ts';
import type { Device, Key } from '../device/device.ts';
import { KEYS } from '../device/device.ts';
import type { AssetSource } from '../device/elements.ts';
import { isSanePath } from '../device/elements.ts';
import { readBody, sendBytes, sendError, sendJson, sendOk } from './http.ts';

/** The API version the emulator reports, as the pinned firmware does. */
export const API_SEMVER = '27.14.0';
const API_MAJOR = 27;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/** What the API reads the screen from. */
interface ScreenSource {
  /** The front display as 72x16 RGB888 in B,G,R order. */
  front(): Uint8Array;
  /** The back display as 160x80 greyscale, one byte per pixel. */
  back(): Uint8Array;
}

export interface ApiContext {
  readonly device: Device;
  readonly screen: ScreenSource;
  readonly startedAt: number;
  readonly firmwareCommit: string;
}

type Handler = (
  request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
) => Promise<void> | void;

const ROUTES: Readonly<
  Record<string, Readonly<Partial<Record<string, Handler>>>>
> = {
  '/api/version': {
    GET: (_r, _u, _c, response) => {
      sendJson(response, 200, { api_semver: API_SEMVER });
    },
  },
  '/api/status': {
    GET: (_r, _u, context, response) => {
      sendJson(response, 200, status(context));
    },
  },
  '/api/status/device': { GET: statusPart('device') },
  '/api/status/firmware': { GET: statusPart('firmware') },
  '/api/status/system': { GET: statusPart('system') },
  '/api/status/power': { GET: statusPart('power') },
  '/api/display/draw': { POST: draw, DELETE: clear },
  '/api/display/brightness': { GET: getBrightness, POST: setBrightness },
  '/api/audio/play': { POST: play, DELETE: stop },
  '/api/audio/volume': { GET: getVolume, POST: setVolume },
  '/api/assets/upload': { POST: upload, DELETE: deleteUploads },
  '/api/screen': { GET: screen },
  '/api/input': { POST: input },
  '/api/busy/snapshot': { GET: getBusySnapshot, PUT: setBusySnapshot },
};

/** Answer one `/api/...` request. */
export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: ApiContext,
): Promise<void> {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      response.end();
      return;
    }
    checkVersion(request, url);
    const route = ROUTES[url.pathname];
    if (route === undefined) {
      throw new ApiError(400, 'Bad Request');
    }
    const handler = route[request.method ?? 'GET'];
    if (handler === undefined) {
      response.setHeader('allow', Object.keys(route).join(', '));
      throw new ApiError(405, 'Method Not Allowed');
    }
    await handler(request, url, context, response);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }
    throw error;
  }
}

/**
 * busy-lib sends the version it read from /api/version on every request;
 * the bar refuses another major version, but always answers /api/version
 * itself. Like the firmware, it reads only the major part, as an 8-bit
 * number.
 */
function checkVersion(request: IncomingMessage, url: URL): void {
  const header = request.headers['x-api-sem-ver'];
  if (typeof header !== 'string' || url.pathname.endsWith('/version')) {
    return;
  }
  const major = /^(\d+)(?:\.|$)/u.exec(header.trim())?.[1];
  if (major === undefined || Number(major) > 0xff) {
    throw new ApiError(400, 'Bad Request');
  }
  if (Number(major) !== API_MAJOR) {
    throw new ApiError(405, 'Incompatible API version');
  }
}

function status(context: ApiContext) {
  const now = Date.now();
  const seconds = Math.floor((now - context.startedAt) / 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const uptime = `${pad(Math.floor(seconds / 86_400))}d ${pad(Math.floor(seconds / 3600))}h ${pad(Math.floor(seconds / 60) % 60)}m ${pad(seconds % 60)}s`;
  return {
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
      build_date: new Date(context.startedAt).toISOString().slice(0, 10),
      commit_hash: context.firmwareCommit.slice(0, 8),
      intercom_version: '0',
      matter_version: '1.0',
    },
    system: {
      api_semver: API_SEMVER,
      uptime,
      boot_time: Math.floor(context.startedAt / 1000),
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
}

function statusPart(part: keyof ReturnType<typeof status>): Handler {
  return (_request, _url, context, response) => {
    sendJson(response, 200, status(context)[part]);
  };
}

async function draw(
  request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  await context.device.draw(
    lenientJson(await readBody(request, MAX_JSON_BYTES)),
  );
  sendOk(response);
}

/**
 * The body as the firmware's JSON getters see it: unparsable JSON finds no
 * fields, so the request fails on its first required one.
 */
function lenientJson(raw: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return undefined;
  }
}

async function clear(
  request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  const raw = await readBody(request, MAX_JSON_BYTES);
  let fromBody: string | undefined;
  let ids: string[] | undefined;
  if (raw.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw new ApiError(400, 'body contains malformed JSON');
    }
    if (!isObject(body)) {
      throw new ApiError(400, 'body JSON must be an object');
    }
    // Present with the wrong type is a 400 here, unlike absent.
    if ('element_ids' in body) {
      const list = body['element_ids'];
      if (
        !Array.isArray(list) ||
        !list.every((id: unknown) => typeof id === 'string')
      ) {
        throw new ApiError(400, 'element_ids must be an array of strings');
      }
      ids = list.filter((id: unknown) => typeof id === 'string');
    }
    if ('application_name' in body) {
      fromBody = stringAt(body, 'application_name');
      if (fromBody === undefined) {
        throw new ApiError(400, 'application_name must be a string');
      }
    }
  }
  // The bar reads the query value into a 64-byte buffer; an empty or longer
  // value counts as absent.
  const query = url.searchParams.get('application_name') ?? '';
  const fromQuery = query.length >= 1 && query.length < 64 ? query : undefined;
  if (fromQuery !== undefined && fromBody !== undefined) {
    throw new ApiError(
      400,
      'application_name present in both the body and query parameters; exactly one is required',
    );
  }
  context.device.screen.clear(fromQuery ?? fromBody, ids);
  sendOk(response);
}

function getBrightness(
  _request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  const { brightness } = context.device;
  sendJson(response, 200, {
    value: brightness === 'auto' ? 'auto' : String(brightness),
  });
}

function setBrightness(
  _request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  const value = url.searchParams.get('value') ?? '';
  if (value === 'auto') {
    context.device.setBrightness('auto');
  } else {
    context.device.setBrightness(percent(value));
  }
  sendOk(response);
}

async function play(
  request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  const json = lenientJson(await readBody(request, MAX_JSON_BYTES));
  const body = isObject(json) ? json : {};
  const application = stringAt(body, 'application_name');
  if (application === undefined) {
    throw new ApiError(400, 'Missing application_name');
  }
  const path = stringAt(body, 'path');
  const stock = stringAt(body, 'stock_path');
  if (path !== undefined && stock !== undefined) {
    throw new ApiError(400, 'Both path and stock_path are defined');
  }
  let source: AssetSource;
  if (path !== undefined) {
    if (!isSanePath(`/ext/user_assets/${application}/${path}`)) {
      throw new ApiError(400, 'Invalid path');
    }
    source = { kind: 'path', path };
  } else if (stock !== undefined) {
    const slash = stock.lastIndexOf('/');
    if (slash === -1 || slash === stock.length - 1) {
      throw new ApiError(400, 'Wrong file name');
    }
    source = { kind: 'stock', path: stock };
  } else {
    throw new ApiError(400, 'Missing path or stock_path');
  }
  await context.device.play(application, source);
  sendOk(response);
}

function stop(
  _request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  context.device.stopSound();
  sendOk(response);
}

function getVolume(
  _request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  sendJson(response, 200, { volume: context.device.volume });
}

async function setVolume(
  _request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  const volume = percent(url.searchParams.get('volume') ?? '');
  const silent = url.searchParams.get('silent');
  if (silent !== null && silent !== '0' && silent !== '1') {
    throw new ApiError(400, 'Bad Request');
  }
  await context.device.setVolume(volume, silent === '1');
  sendOk(response);
}

const APPLICATION_NAME = /^[A-Za-z0-9._-]{1,31}$/u;
const FILE_NAME = /^[A-Za-z0-9._/-]{1,64}$/u;

async function upload(
  request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  const application = url.searchParams.get('application_name') ?? '';
  const file = url.searchParams.get('file') ?? '';
  const badFile =
    !FILE_NAME.test(file) ||
    file.startsWith('/') ||
    file.endsWith('/') ||
    file.includes('//') ||
    file.includes('..');
  if (!APPLICATION_NAME.test(application) || badFile) {
    throw new ApiError(400, 'Bad Request');
  }
  const data = await readBody(request, MAX_UPLOAD_BYTES);
  context.device.assets.upload(application, file, data);
  response.setHeader('connection', 'close');
  sendOk(response);
}

function deleteUploads(
  _request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  const application = url.searchParams.get('application_name') ?? '';
  if (!APPLICATION_NAME.test(application)) {
    throw new ApiError(400, 'Bad Request');
  }
  context.device.assets.deleteUploads(application);
  sendOk(response);
}

/**
 * The raw framebuffer as base64 text, under the firmware's own
 * `image/bmp` content type: the front as B,G,R bytes, the back as 4-bit
 * grey with the even pixel in the low nibble.
 */
function screen(
  _request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  const display = url.searchParams.get('display');
  if (display === '0') {
    sendImage(response, context.screen.front());
    return;
  }
  if (display === '1') {
    sendImage(response, packGrey4(context.screen.back()));
    return;
  }
  throw new ApiError(400, 'Wrong display');
}

/**
 * Grey pixels packed as the firmware's color_buf_l8_to_l4 packs the back
 * display: the top four bits of each grey pixel, two pixels a byte, the
 * even pixel in the low nibble.
 */
export function packGrey4(grey: Uint8Array): Uint8Array {
  const packed = new Uint8Array(grey.length / 2);
  for (let i = 0; i < packed.length; i += 1) {
    packed[i] = ((grey[i * 2] ?? 0) >> 4) | ((grey[i * 2 + 1] ?? 0) & 0xf0);
  }
  return packed;
}

/** The firmware's MG_REPLY_IMAGE: base64 text, with the API's CORS headers. */
function sendImage(response: ServerResponse, frame: Uint8Array): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', '*');
  sendBytes(response, 'image/bmp', Buffer.from(frame).toString('base64'));
}

function input(
  _request: IncomingMessage,
  url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  const key = KEYS.find(
    (candidate): candidate is Key => candidate === url.searchParams.get('key'),
  );
  if (key === undefined) {
    throw new ApiError(400, 'Bad Request');
  }
  context.device.press(key);
  sendOk(response);
}

function getBusySnapshot(
  _request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): void {
  sendJson(response, 200, context.device.busySnapshot);
}

async function setBusySnapshot(
  request: IncomingMessage,
  _url: URL,
  context: ApiContext,
  response: ServerResponse,
): Promise<void> {
  context.device.setBusySnapshot(
    lenientJson(await readBody(request, MAX_JSON_BYTES)),
  );
  sendOk(response);
}

/** A 0 to 100 query value; the bar reads at most four characters of it. */
function percent(value: string): number {
  if (!/^\d{1,4}$/u.test(value) || Number(value) > 100) {
    throw new ApiError(400, 'Bad Request');
  }
  return Number(value);
}
