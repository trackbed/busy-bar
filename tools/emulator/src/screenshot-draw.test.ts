import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AssetRoot } from './__tests__/asset-root.ts';
import { assetRoot } from './__tests__/asset-root.ts';
import type { AssetLibrary } from './assets/library.ts';
import { ApiError } from './device/api-error.ts';
import { decodePng } from './formats/png.ts';
import { screenshotDraw } from './screenshot-draw.ts';

const NOW = Date.parse('2026-10-21T09:00:00Z');

let root: AssetRoot;
let assets: AssetLibrary;

beforeAll(async () => {
  root = await assetRoot();
  assets = await root.open();
});

afterAll(async () => {
  await root.cleanup();
});

function pixel(png: Uint8Array, x: number, y: number): number[] {
  const { width, rgba } = decodePng(png);
  return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

const square = (display: 'front' | 'back') => ({
  id: `square-${display}`,
  type: 'rectangle',
  display,
  width: 2,
  height: 2,
  fill: 'solid',
  fill_colors: ['#FF0000FF'],
  border_width: 0,
});

describe('screenshotDraw', () => {
  it('draws on both displays', async () => {
    const shots = await screenshotDraw(
      assets,
      { application_name: 'app', elements: [square('front'), square('back')] },
      NOW,
    );

    expect(decodePng(shots.front)).toMatchObject({ width: 72, height: 16 });
    expect(decodePng(shots.back)).toMatchObject({ width: 160, height: 80 });
    expect(pixel(shots.front, 1, 1)).toStrictEqual([255, 0, 0, 255]);
    expect(pixel(shots.front, 2, 0)).toStrictEqual([0, 0, 0, 255]);
    // The back is grey: red lands on one of its 16 levels.
    const [grey] = pixel(shots.back, 1, 1);
    expect(grey).toBeGreaterThan(0);
    expect((grey ?? 0) % 17).toBe(0);
  });

  it('refuses a request the bar would refuse', async () => {
    await expect(
      screenshotDraw(assets, { application_name: 'app', elements: [] }, NOW),
    ).rejects.toThrow(new ApiError(400, 'Elements array is empty'));
  });
});
