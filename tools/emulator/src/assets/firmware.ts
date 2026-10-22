// The pinned firmware's assets, synced into the user's cache and opened:
// what both the emulator and tools that draw like the bar start from.

import { homedir } from 'node:os';
import { join } from 'node:path';

import manifest from './firmware-assets.json' with { type: 'json' };
import { AssetLibrary } from './library.ts';
import { syncAssets } from './sync.ts';

const STOCK_IMAGE = /^assets\/shared\/images\/external\/([^/]+)\.png$/u;

/** The firmware commit the assets are pinned to. */
export const FIRMWARE_COMMIT = manifest.commit;

export interface FirmwareAssetsOptions {
  /** Called after each file is checked or downloaded. */
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Fetch the firmware's fonts and stock assets into
 * `${XDG_CACHE_HOME:-~/.cache}/busy-bar-apps/emulator` (once; later calls
 * work offline), then open them.
 */
export async function openFirmwareAssets(
  options: FirmwareAssetsOptions = {},
): Promise<AssetLibrary> {
  const cacheHome =
    process.env['XDG_CACHE_HOME']?.trim() || join(homedir(), '.cache');
  const root = await syncAssets({
    manifest,
    cacheDir: join(cacheHome, 'busy-bar-apps', 'emulator'),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });
  const stockImages = manifest.files.flatMap(
    (file) => STOCK_IMAGE.exec(file.path)?.[1] ?? [],
  );
  return AssetLibrary.open(root, stockImages);
}
