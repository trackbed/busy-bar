// Stock animations as the firmware repository keeps them: a ZIP holding one
// folder of numbered PNG frames and a meta.json with the frame rate, colour
// mode, and named sections (assets/animations/README.md in the firmware).
// The firmware's converter (scripts/seq2anim.py) reduces colours by the mode
// and stores the rest losslessly, so applying the same reduction here gives
// the frames the bar shows.

import {
  arrayAt,
  isObject,
  numberAt,
  stringAt,
} from '@busy-bar-apps/json-values';

import type { Bitmap } from './png.ts';
import { decodePng } from './png.ts';
import { readZip } from './zip.ts';

/** A frame range, inclusive at both ends. */
export interface Section {
  readonly start: number;
  readonly end: number;
}

export interface Animation {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: readonly Bitmap[];
  readonly sections: ReadonlyMap<string, Section>;
}

/** The archive is not an animation the emulator can play. */
export class AnimationError extends Error {
  override readonly name = 'AnimationError';
}

export const DEFAULT_FPS = 30;

/**
 * Read an animation archive. Frames play in the order of the number in
 * their names (`frame_9` before `frame_10`, `coding_00197` after
 * `coding_00196`); macOS metadata files are ignored.
 */
export function readAnimation(bytes: Uint8Array): Animation {
  const entries = readZip(bytes);
  const frames = entries
    .filter((entry) => {
      const base = entry.name.slice(entry.name.lastIndexOf('/') + 1);
      return base.toLowerCase().endsWith('.png') && !base.startsWith('.');
    })
    .map((entry) => ({ order: frameNumber(entry.name), data: entry.data }))
    .sort((a, b) => a.order - b.order)
    .map((frame) => decodePng(frame.data));
  const [first] = frames;
  if (first === undefined) {
    throw new AnimationError('The archive holds no PNG frames.');
  }
  if (
    frames.some(
      (frame) => frame.width !== first.width || frame.height !== first.height,
    )
  ) {
    throw new AnimationError('The frames are not all the same size.');
  }
  const meta = entries.find((entry) => entry.name.endsWith('meta.json'));
  const { fps, colorMode, sections } = readMeta(meta?.data, frames.length);
  return {
    width: first.width,
    height: first.height,
    fps,
    frames: frames.map((frame) => reduceColors(frame, colorMode)),
    sections,
  };
}

type ColorMode = 'rgb888' | 'gray4' | 'argb8888';
const COLOR_MODES: readonly ColorMode[] = ['rgb888', 'gray4', 'argb8888'];

/**
 * The converter's colour reduction: `rgb888` drops alpha, `gray4` keeps
 * the top four bits of red as grey, and `argb8888` keeps everything.
 */
function reduceColors(frame: Bitmap, mode: ColorMode): Bitmap {
  if (mode === 'argb8888') {
    return frame;
  }
  const rgba = frame.rgba.slice();
  for (let at = 0; at < rgba.length; at += 4) {
    if (mode === 'gray4') {
      const grey = (rgba[at] ?? 0) & 0xf0;
      rgba[at] = grey;
      rgba[at + 1] = grey;
      rgba[at + 2] = grey;
    }
    rgba[at + 3] = 255;
  }
  return { width: frame.width, height: frame.height, rgba };
}

function frameNumber(name: string): number {
  const digits = /(\d+)(?=\D*$)/u.exec(name.slice(name.lastIndexOf('/') + 1));
  return digits === null ? 0 : Number(digits[1]);
}

function readMeta(
  data: Uint8Array | undefined,
  frameCount: number,
): {
  readonly fps: number;
  readonly colorMode: ColorMode;
  readonly sections: ReadonlyMap<string, Section>;
} {
  const sections = new Map<string, Section>();
  if (data === undefined) {
    return { fps: DEFAULT_FPS, colorMode: 'argb8888', sections };
  }
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    throw new AnimationError('meta.json is not valid JSON.', { cause: error });
  }
  if (!isObject(meta)) {
    throw new AnimationError('meta.json does not hold an object.');
  }
  const fps = numberAt(meta, 'fps') ?? 0;
  const colorMode =
    COLOR_MODES.find((mode) => stringAt(meta, 'color_mode') === mode) ??
    'argb8888';
  for (const item of arrayAt(meta, 'sections')) {
    if (!isObject(item)) {
      continue;
    }
    const name = stringAt(item, 'name');
    const start = numberAt(item, 'start');
    const end = numberAt(item, 'end');
    if (
      name !== undefined &&
      start !== undefined &&
      end !== undefined &&
      start >= 0 &&
      start <= end &&
      end < frameCount
    ) {
      sections.set(name, { start, end });
    }
  }
  return { fps: fps > 0 ? fps : DEFAULT_FPS, colorMode, sections };
}
