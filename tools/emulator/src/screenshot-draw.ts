// Draw one request on a fresh bar and screenshot both displays: how tools
// show what an app draws without running a server.

import type { AssetLibrary } from './assets/library.ts';
import { Device } from './device/device.ts';
import { SceneRenderer } from './render/scene.ts';
import { screenshotPng } from './render/screenshot.ts';

/** PNGs of both displays, one pixel per pixel. */
export interface Screenshots {
  readonly front: Uint8Array;
  readonly back: Uint8Array;
}

/**
 * Validate `body` as `POST /api/display/draw` does, draw it on an idle bar,
 * and screenshot both displays at `now`, in milliseconds since the epoch.
 * Throws the API's `ApiError`, with the bar's 400 message, for a request the
 * bar would refuse.
 */
export async function screenshotDraw(
  assets: AssetLibrary,
  body: unknown,
  now: number,
): Promise<Screenshots> {
  const device = new Device(assets, () => now);
  await device.draw(body);
  const { screen } = device;
  const { front, back } = new SceneRenderer(assets).render(
    { elements: screen.elements(), application: screen.owner?.app },
    now,
  );
  return {
    front: screenshotPng(front, 'front', 1),
    back: screenshotPng(back, 'back', 1),
  };
}
