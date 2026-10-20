// A stand-in for the synced firmware assets: a temporary folder laid out
// like the firmware repository, holding small generated files, so tests can
// open a real AssetLibrary without the network.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AssetLibrary, FONT_FILES } from '../assets/library.ts';
import { rawPcmSound } from '../formats/sound.ts';
import { solidPng, zip } from './fixtures.ts';
import { boxFont } from './font-fixture.ts';

/** Stock images the folder holds, by name without extension. */
const STOCK_IMAGES = [
  'dot_2x2',
  'wide_80x4',
  'active_indicator_left_28x7',
  'active_indicator_right_28x7',
] as const;

/**
 * A two-frame red/green animation at 10 fps, 4x2 pixels, with a `green`
 * section holding only its second frame.
 */
export const STOCK_ANIMATION = 'blink_4x2';

/** A 100 ms silent WAV. */
export const STOCK_SOUND = 'beep';

export interface AssetRoot {
  readonly root: string;
  open(): Promise<AssetLibrary>;
  cleanup(): Promise<void>;
}

export async function assetRoot(): Promise<AssetRoot> {
  const root = await mkdtemp(join(tmpdir(), 'emulator-assets-'));
  const put = async (path: string, data: Uint8Array): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), data);
  };
  const font = boxFont();
  await Promise.all(
    Object.values(FONT_FILES).map((file) =>
      put(`assets/shared/fonts/${file}.font`, font),
    ),
  );
  await put(
    'assets/shared/images/external/dot_2x2.png',
    solidPng(2, 2, [255, 0, 0, 255]),
  );
  await put(
    'assets/shared/images/external/wide_80x4.png',
    solidPng(80, 4, [0, 0, 255, 255]),
  );
  await put(
    'assets/shared/images/external/active_indicator_left_28x7.png',
    solidPng(28, 7, [0, 0, 0, 255]),
  );
  await put(
    'assets/shared/images/external/active_indicator_right_28x7.png',
    solidPng(28, 7, [0, 0, 0, 255]),
  );
  await put(
    'assets/images/internal/load_error_9x9.png',
    solidPng(9, 9, [255, 255, 0, 255]),
  );
  await put(
    `assets/shared/animations/${STOCK_ANIMATION}.zip`,
    zip([
      {
        name: `${STOCK_ANIMATION}/frame_0.png`,
        data: solidPng(4, 2, [255, 0, 0, 255]),
      },
      {
        name: `${STOCK_ANIMATION}/frame_1.png`,
        data: solidPng(4, 2, [0, 255, 0, 255]),
      },
      {
        name: `${STOCK_ANIMATION}/meta.json`,
        data: new TextEncoder().encode(
          JSON.stringify({
            fps: 10,
            color_mode: 'rgb888',
            sections: [{ name: 'green', start: 1, end: 1 }],
          }),
        ),
      },
    ]),
  );
  await put(
    `assets/shared/sounds/${STOCK_SOUND}.wav`,
    rawPcmSound(new Uint8Array(8820)).wav,
  );
  return {
    root,
    open: () => AssetLibrary.open(root, STOCK_IMAGES),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
