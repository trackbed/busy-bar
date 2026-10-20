// Every file the emulator draws or plays: the firmware's fonts and stock
// assets from the synced cache, and what apps upload with
// POST /api/assets/upload. Files resolve as on the bar: a stock path by its
// basename, with the device's extension, under the shared folder for its
// kind; a path under the app's own uploads.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetFolder, AssetSource, FontName } from '../device/elements.ts';
import { devicePath, FONTS } from '../device/elements.ts';
import { readAnimFile } from '../formats/anim-file.ts';
import type { Animation } from '../formats/animation.ts';
import { readAnimation } from '../formats/animation.ts';
import type { Font } from '../formats/font.ts';
import { readFont } from '../formats/font.ts';
import type { Bitmap } from '../formats/png.ts';
import { decodePng } from '../formats/png.ts';
import type { Sound } from '../formats/sound.ts';
import { rawPcmSound, wavSound } from '../formats/sound.ts';

// Where the sources of /ext/apps_assets/shared live in the firmware
// repository, and the extension each kind has on the device.
const STOCK: Readonly<
  Record<
    AssetFolder,
    { readonly dir: string; readonly device: string; readonly source: string }
  >
> = {
  images: {
    dir: 'assets/shared/images/external',
    device: '.image',
    source: '.png',
  },
  animations: {
    dir: 'assets/shared/animations',
    device: '.anim',
    source: '.zip',
  },
  sounds: { dir: 'assets/shared/sounds', device: '.snd', source: '.wav' },
};
const FONT_DIR = 'assets/shared/fonts';
const ERROR_ICON = 'assets/images/internal/load_error_9x9.png';

/** The font file behind each API font name (font_paths in api_display.c). */
export const FONT_FILES: Readonly<Record<FontName, string>> = {
  tiny: 'busy_tiny',
  small: 'busy_regular_5',
  normal: 'busy_regular_7',
  condensed: 'busy_condensed_7',
  bold: 'busy_bold_7',
  large: 'busy_regular_9',
  extra_large: 'busy_bold_10',
  global: 'lana_pixel_regular_11',
  superscript: 'busy_superscript_7',
};

/** Fonts, stock images, and the error icon, decoded up front. */
interface Loaded {
  readonly fonts: ReadonlyMap<FontName, Font>;
  readonly images: ReadonlyMap<string, Bitmap>;
  readonly errorIcon: Bitmap;
}

export class AssetLibrary {
  readonly #root: string;
  readonly #loaded: Loaded;
  readonly #uploads = new Map<string, Uint8Array>();
  readonly #uploadedImages = new Map<string, Bitmap | undefined>();
  readonly #animations = new Map<string, Promise<Animation | undefined>>();
  readonly #readyAnimations = new Map<string, Animation | undefined>();

  private constructor(root: string, loaded: Loaded) {
    this.#root = root;
    this.#loaded = loaded;
  }

  /**
   * Open the synced commit folder (see `syncAssets`): decode every font,
   * every stock image the API can name, and the error icon.
   */
  static async open(
    root: string,
    stockImages: readonly string[],
  ): Promise<AssetLibrary> {
    const [fonts, images, errorIcon] = await Promise.all([
      Promise.all(
        FONTS.map(async (name) => {
          const font = await readFile(
            join(root, FONT_DIR, `${FONT_FILES[name]}.font`),
          );
          return [name, readFont(font)] as const;
        }),
      ),
      Promise.all(
        stockImages.map(async (name) => {
          const png = await readFile(
            join(root, STOCK.images.dir, `${name}${STOCK.images.source}`),
          );
          return [`${name}${STOCK.images.device}`, decodePng(png)] as const;
        }),
      ),
      readFile(join(root, ERROR_ICON)).then(decodePng),
    ]);
    return new AssetLibrary(root, {
      fonts: new Map(fonts),
      images: new Map(images),
      errorIcon,
    });
  }

  /** The folder the synced firmware files are in. */
  get root(): string {
    return this.#root;
  }

  /** The icon the bar draws for an image or animation it cannot load. */
  get errorIcon(): Bitmap {
    return this.#loaded.errorIcon;
  }

  font(name: FontName): Font {
    const font = this.#loaded.fonts.get(name);
    if (font === undefined) {
      throw new Error(`The ${name} font is not loaded.`);
    }
    return font;
  }

  /** Store an upload, replacing a file of the same name. */
  upload(application: string, file: string, data: Uint8Array): void {
    const path = uploadPath(application, file);
    this.#uploads.set(path, data);
    this.#uploadedImages.delete(path);
    this.#animations.delete(path);
    this.#readyAnimations.delete(path);
  }

  /** Remove everything an application uploaded. */
  deleteUploads(application: string): void {
    const prefix = uploadPath(application, '');
    for (const cache of [
      this.#uploads,
      this.#uploadedImages,
      this.#animations,
      this.#readyAnimations,
    ]) {
      for (const path of cache.keys()) {
        if (path.startsWith(prefix)) {
          cache.delete(path);
        }
      }
    }
  }

  /**
   * An image, decoded, or undefined when the bar could not decode it: a
   * stock name must end in `.image`, an upload must be a PNG named `.png`.
   */
  image(source: AssetSource, application: string): Bitmap | undefined {
    const path = devicePath(source, application, 'images');
    if (source.kind === 'stock') {
      return this.#loaded.images.get(basename(path));
    }
    if (!this.#uploadedImages.has(path)) {
      const data = this.#uploads.get(path);
      this.#uploadedImages.set(
        path,
        data !== undefined && path.endsWith('.png') ? tryPng(data) : undefined,
      );
    }
    return this.#uploadedImages.get(path);
  }

  /** The image's size, for draw validation. */
  imageSize(
    source: AssetSource,
    application: string,
  ): { width: number; height: number } | undefined {
    const image = this.image(source, application);
    return image === undefined
      ? undefined
      : { width: image.width, height: image.height };
  }

  /**
   * Load an animation; undefined when it is missing or unreadable. A stock
   * name must end in `.anim`; an upload must be the bar's own `.anim` format.
   */
  loadAnimation(
    source: AssetSource,
    application: string,
  ): Promise<Animation | undefined> {
    const path = devicePath(source, application, 'animations');
    let loading = this.#animations.get(path);
    if (loading === undefined) {
      loading = this.#readAnimation(source, path).catch(() => undefined);
      this.#animations.set(path, loading);
      void loading.then((animation) => {
        if (this.#animations.get(path) === loading) {
          this.#readyAnimations.set(path, animation);
        }
      });
    }
    return loading;
  }

  /** An animation `loadAnimation` already finished, by its device path. */
  animation(path: string): Animation | undefined {
    return this.#readyAnimations.get(path);
  }

  /** A sound for the page, or undefined when the bar would find no file. */
  async sound(
    source: AssetSource,
    application: string,
  ): Promise<Sound | undefined> {
    const path = devicePath(source, application, 'sounds');
    if (source.kind === 'path') {
      const data = this.#uploads.get(path);
      return data === undefined ? undefined : rawPcmSound(data);
    }
    const stem = stockStem(path, 'sounds');
    if (stem === undefined) {
      return undefined;
    }
    const wav = await readFile(
      join(this.#root, STOCK.sounds.dir, `${stem}${STOCK.sounds.source}`),
    ).catch(() => undefined);
    return wav === undefined ? undefined : wavSound(wav);
  }

  async #readAnimation(
    source: AssetSource,
    path: string,
  ): Promise<Animation | undefined> {
    if (source.kind === 'path') {
      const data = this.#uploads.get(path);
      return data === undefined ? undefined : readAnimFile(data);
    }
    const stem = stockStem(path, 'animations');
    if (stem === undefined) {
      return undefined;
    }
    return readAnimation(
      await readFile(
        join(
          this.#root,
          STOCK.animations.dir,
          `${stem}${STOCK.animations.source}`,
        ),
      ),
    );
  }
}

function uploadPath(application: string, file: string): string {
  return devicePath({ kind: 'path', path: file }, application, 'images');
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A stock file's name without its device extension, if it has that extension. */
function stockStem(path: string, folder: AssetFolder): string | undefined {
  const name = basename(path);
  const { device } = STOCK[folder];
  return name.endsWith(device) && name.length > device.length
    ? name.slice(0, -device.length)
    : undefined;
}

function tryPng(data: Uint8Array): Bitmap | undefined {
  try {
    return decodePng(data);
  } catch {
    return undefined;
  }
}
