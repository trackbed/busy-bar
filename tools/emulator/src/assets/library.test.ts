import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest';

import type { AssetRoot } from '../__tests__/asset-root.ts';
import {
  assetRoot,
  STOCK_ANIMATION,
  STOCK_SOUND,
} from '../__tests__/asset-root.ts';
import { solidPng } from '../__tests__/fixtures.ts';
import type { AssetSource } from '../device/elements.ts';
import { FONTS } from '../device/elements.ts';
import type { Bitmap } from '../formats/png.ts';
import { rawPcmSound } from '../formats/sound.ts';
import { FONT_FILES } from './library.ts';

interface AnimSection {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A minimal `.anim` ("bicycle1") file as the firmware's converter writes
 * it: a "default" section over every frame, then `sections`, then frames
 * that each fill every pixel with one colour, stored raw as B, G, R.
 */
function animFile(options: {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly colors: readonly (readonly [number, number, number])[];
  readonly sections?: readonly AnimSection[];
}): Uint8Array {
  const { width, height, fps, colors } = options;
  const encoder = new TextEncoder();
  const sections = [
    { name: 'default', start: 0, end: colors.length - 1 },
    ...(options.sections ?? []),
  ].map((section) => ({
    ...section,
    name: encoder.encode(`${section.name}\0`),
  }));
  const pixelBytes = width * height * 3;
  const frameBytes = 5 + pixelBytes;
  const sectionsLength = sections.reduce(
    (sum, section) => sum + 12 + section.name.length,
    0,
  );
  const framesStart = 34 + sectionsLength;
  const bytes = new Uint8Array(framesStart + colors.length * frameBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode('bicycle1'));
  // Bytes 8 and 11, the flags and the colour format, stay 0: BGR888.
  view.setUint8(9, width);
  view.setUint8(10, height);
  view.setUint16(14, pixelBytes, true);
  view.setUint8(16, fps);
  view.setUint32(18, sectionsLength, true);
  view.setUint32(22, colors.length * frameBytes, true);
  view.setUint32(26, sections.length, true);
  view.setUint32(30, colors.length, true);
  let at = 34;
  for (const section of sections) {
    view.setUint32(at, section.start, true);
    view.setUint32(at + 4, section.end, true);
    view.setUint32(at + 8, framesStart + section.start * frameBytes, true);
    bytes.set(section.name, at + 12);
    at += 12 + section.name.length;
  }
  for (const [red, green, blue] of colors) {
    // Mask encoding 1 (every pixel) in the high nibble, raw pixels in the
    // low one, and no mask bits.
    view.setUint8(at, 0x10);
    view.setUint16(at + 3, pixelBytes, true);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      bytes.set([blue, green, red], at + 5 + pixel * 3);
    }
    at += frameBytes;
  }
  return bytes;
}

/** One pixel of a bitmap as [r, g, b, a]. */
function pixel(bitmap: Bitmap | undefined, index = 0): number[] {
  return Array.from(bitmap?.rgba.subarray(index * 4, index * 4 + 4) ?? []);
}

const STOCK_ANIM: AssetSource = {
  kind: 'stock',
  path: `shared/${STOCK_ANIMATION}.anim`,
};
const STOCK_ANIM_PATH = `/ext/apps_assets/shared/animations/${STOCK_ANIMATION}.anim`;

let fixture: AssetRoot;

beforeAll(async () => {
  fixture = await assetRoot();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('AssetLibrary', () => {
  describe('open', () => {
    it('loads every API font, the stock images, and the error icon', async () => {
      const library = await fixture.open();

      expect(library.root).toBe(fixture.root);
      // The fixture's box font has 6-pixel lines.
      expect(FONTS.map((name) => library.font(name).lineHeight)).toStrictEqual(
        FONTS.map(() => 6),
      );
      expect(library.errorIcon).toMatchObject({ width: 9, height: 9 });
      expect(pixel(library.errorIcon)).toStrictEqual([255, 255, 0, 255]);
    });

    it('maps the API font names to the firmware font files', () => {
      // font_paths in the firmware's api_display.c.
      expect(FONT_FILES).toStrictEqual({
        tiny: 'busy_tiny',
        small: 'busy_regular_5',
        normal: 'busy_regular_7',
        condensed: 'busy_condensed_7',
        bold: 'busy_bold_7',
        large: 'busy_regular_9',
        extra_large: 'busy_bold_10',
        global: 'lana_pixel_regular_11',
        superscript: 'busy_superscript_7',
      });
    });

    it('fails to open without a font file', async () => {
      const broken = await assetRoot();
      onTestFinished(() => broken.cleanup());
      await rm(
        join(broken.root, 'assets/shared/fonts/lana_pixel_regular_11.font'),
      );

      await expect(broken.open()).rejects.toThrow('lana_pixel_regular_11.font');
    });
  });

  describe('image', () => {
    it('finds a stock image by its basename with the .image extension', async () => {
      const library = await fixture.open();
      const dot = library.image(
        { kind: 'stock', path: 'shared/dot_2x2.image' },
        'clock',
      );

      expect(dot).toMatchObject({ width: 2, height: 2 });
      expect(pixel(dot)).toStrictEqual([255, 0, 0, 255]);
      expect(
        library.image(
          { kind: 'stock', path: 'any/folder/dot_2x2.image' },
          'news',
        ),
      ).toBe(dot);
    });

    it.each(['shared/dot_2x2.png', 'shared/dot_2x2', 'shared/missing.image'])(
      'finds no stock image for %j',
      async (path) => {
        const library = await fixture.open();

        expect(library.image({ kind: 'stock', path }, 'clock')).toBeUndefined();
      },
    );

    it('decodes an uploaded PNG from its app folder only', async () => {
      const library = await fixture.open();
      library.upload(
        'clock',
        'icons/logo.png',
        solidPng(3, 2, [0, 255, 0, 255]),
      );
      const logo = library.image(
        { kind: 'path', path: 'icons/logo.png' },
        'clock',
      );

      expect(logo).toMatchObject({ width: 3, height: 2 });
      expect(pixel(logo)).toStrictEqual([0, 255, 0, 255]);
      expect(
        library.image({ kind: 'path', path: 'icons/logo.png' }, 'news'),
      ).toBeUndefined();
    });

    it('finds no image in an upload not named .png or not a PNG', async () => {
      const library = await fixture.open();
      library.upload('clock', 'logo.image', solidPng(3, 2, [0, 255, 0, 255]));
      library.upload('clock', 'broken.png', Uint8Array.from([1, 2, 3]));

      expect(
        library.image({ kind: 'path', path: 'logo.image' }, 'clock'),
      ).toBeUndefined();
      expect(
        library.image({ kind: 'path', path: 'broken.png' }, 'clock'),
      ).toBeUndefined();
    });

    it('keeps a decoded upload until it is uploaded again', async () => {
      const library = await fixture.open();
      const source: AssetSource = { kind: 'path', path: 'logo.png' };

      expect(library.image(source, 'clock')).toBeUndefined();

      library.upload('clock', 'logo.png', solidPng(3, 2, [0, 255, 0, 255]));
      const first = library.image(source, 'clock');

      expect(first).toMatchObject({ width: 3, height: 2 });
      expect(library.image(source, 'clock')).toBe(first);

      library.upload('clock', 'logo.png', solidPng(5, 1, [0, 0, 255, 255]));

      expect(library.imageSize(source, 'clock')).toStrictEqual({
        width: 5,
        height: 1,
      });
    });

    it('reports image sizes for draw validation', async () => {
      const library = await fixture.open();

      expect(
        library.imageSize(
          { kind: 'stock', path: 'shared/wide_80x4.image' },
          'clock',
        ),
      ).toStrictEqual({ width: 80, height: 4 });
      expect(
        library.imageSize(
          { kind: 'stock', path: 'shared/missing.image' },
          'clock',
        ),
      ).toBeUndefined();
    });
  });

  describe('loadAnimation', () => {
    it('loads a stock animation from its ZIP, ready once it settles', async () => {
      const library = await fixture.open();
      const loading = library.loadAnimation(STOCK_ANIM, 'clock');

      expect(library.animation(STOCK_ANIM_PATH)).toBeUndefined();

      const animation = await loading;

      expect(animation).toMatchObject({ width: 4, height: 2, fps: 10 });
      expect(animation?.frames.map((frame) => pixel(frame))).toStrictEqual([
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ]);
      expect(animation?.sections.get('green')).toStrictEqual({
        start: 1,
        end: 1,
      });
      expect(library.animation(STOCK_ANIM_PATH)).toBe(animation);
    });

    it('shares one load per device path', async () => {
      const library = await fixture.open();
      const first = library.loadAnimation(STOCK_ANIM, 'clock');

      expect(
        library.loadAnimation(
          { kind: 'stock', path: `other/${STOCK_ANIMATION}.anim` },
          'news',
        ),
      ).toBe(first);
      await expect(first).resolves.toBeDefined();
    });

    it.each([
      `shared/${STOCK_ANIMATION}.zip`,
      `shared/${STOCK_ANIMATION}`,
      'shared/.anim',
      'shared/missing.anim',
    ])('loads no stock animation for %j', async (path) => {
      const library = await fixture.open();

      await expect(
        library.loadAnimation({ kind: 'stock', path }, 'clock'),
      ).resolves.toBeUndefined();
    });

    it('loads an upload in the bar format', async () => {
      const library = await fixture.open();
      library.upload(
        'clock',
        'pulse.anim',
        animFile({
          width: 2,
          height: 1,
          fps: 30,
          colors: [
            [255, 0, 0],
            [0, 0, 255],
          ],
          sections: [{ name: 'blue', start: 1, end: 1 }],
        }),
      );
      const animation = await library.loadAnimation(
        { kind: 'path', path: 'pulse.anim' },
        'clock',
      );

      expect(animation).toMatchObject({ width: 2, height: 1, fps: 30 });
      expect(animation?.frames.map((frame) => pixel(frame, 1))).toStrictEqual([
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ]);
      expect(animation?.sections.get('blue')).toStrictEqual({
        start: 1,
        end: 1,
      });
      expect(library.animation('/ext/user_assets/clock/pulse.anim')).toBe(
        animation,
      );
    });

    it('loads nothing from a missing or unreadable upload', async () => {
      const library = await fixture.open();
      library.upload('clock', 'blink.anim', solidPng(1, 1, [0, 0, 0, 255]));

      await expect(
        library.loadAnimation({ kind: 'path', path: 'blink.anim' }, 'clock'),
      ).resolves.toBeUndefined();
      await expect(
        library.loadAnimation({ kind: 'path', path: 'missing.anim' }, 'clock'),
      ).resolves.toBeUndefined();
    });

    it('drops a load overtaken by a new upload of the file', async () => {
      const library = await fixture.open();
      const source: AssetSource = { kind: 'path', path: 'pulse.anim' };
      const path = '/ext/user_assets/clock/pulse.anim';
      const solid = (color: readonly [number, number, number]) =>
        animFile({ width: 1, height: 1, fps: 10, colors: [color] });
      library.upload('clock', 'pulse.anim', solid([255, 0, 0]));
      const stale = library.loadAnimation(source, 'clock');
      library.upload('clock', 'pulse.anim', solid([0, 255, 0]));
      await stale;

      expect(library.animation(path)).toBeUndefined();

      const fresh = await library.loadAnimation(source, 'clock');

      expect(pixel(fresh?.frames[0])).toStrictEqual([0, 255, 0, 255]);
      expect(library.animation(path)).toBe(fresh);
    });
  });

  describe('sound', () => {
    it('wraps an upload as raw PCM in a WAV', async () => {
      const library = await fixture.open();
      library.upload('clock', 'tone.pcm', new Uint8Array(4410).fill(7));
      const sound = await library.sound(
        { kind: 'path', path: 'tone.pcm' },
        'clock',
      );

      // 4410 bytes of 16-bit mono samples at 44.1 kHz play for 50 ms.
      expect(sound?.durationMs).toBe(50);
      expect(sound?.wav).toHaveLength(44 + 4410);
      expect(new TextDecoder().decode(sound?.wav.subarray(0, 4))).toBe('RIFF');
      expect(sound?.wav[44]).toBe(7);
    });

    it('passes a stock sound through from its WAV source', async () => {
      const library = await fixture.open();
      const sound = await library.sound(
        { kind: 'stock', path: `shared/${STOCK_SOUND}.snd` },
        'clock',
      );

      expect(sound?.durationMs).toBe(100);
      expect(sound?.wav).toStrictEqual(
        Buffer.from(rawPcmSound(new Uint8Array(8820)).wav),
      );
    });

    it.each<[AssetSource]>([
      [{ kind: 'stock', path: `shared/${STOCK_SOUND}.wav` }],
      [{ kind: 'stock', path: 'shared/.snd' }],
      [{ kind: 'stock', path: 'shared/missing.snd' }],
      [{ kind: 'path', path: 'missing.pcm' }],
    ])('finds no sound for %j', async (source) => {
      const library = await fixture.open();

      await expect(library.sound(source, 'clock')).resolves.toBeUndefined();
    });
  });

  describe('deleteUploads', () => {
    it("drops one app's uploads and what was read from them", async () => {
      const library = await fixture.open();
      const logo: AssetSource = { kind: 'path', path: 'logo.png' };
      const pulse: AssetSource = { kind: 'path', path: 'pulse.anim' };
      const tone: AssetSource = { kind: 'path', path: 'tone.pcm' };
      for (const app of ['clock', 'clockwork']) {
        library.upload(app, 'logo.png', solidPng(1, 1, [0, 0, 0, 255]));
      }
      library.upload(
        'clock',
        'pulse.anim',
        animFile({ width: 1, height: 1, fps: 10, colors: [[0, 0, 255]] }),
      );
      library.upload('clock', 'tone.pcm', new Uint8Array(4410));

      expect(library.image(logo, 'clock')).toBeDefined();
      await expect(
        library.loadAnimation(pulse, 'clock'),
      ).resolves.toBeDefined();

      library.deleteUploads('clock');

      expect(library.image(logo, 'clock')).toBeUndefined();
      expect(library.image(logo, 'clockwork')).toBeDefined();
      expect(
        library.animation('/ext/user_assets/clock/pulse.anim'),
      ).toBeUndefined();
      await expect(
        library.loadAnimation(pulse, 'clock'),
      ).resolves.toBeUndefined();
      await expect(library.sound(tone, 'clock')).resolves.toBeUndefined();
      expect(
        library.image({ kind: 'stock', path: 'shared/dot_2x2.image' }, 'clock'),
      ).toBeDefined();
    });
  });
});
