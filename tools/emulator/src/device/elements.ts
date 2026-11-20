// Parsing and validating draw requests the way the firmware's web server
// does (applications/services/web_server/http_api/api_display.c): the same
// defaults, the same leniency (a field of the wrong type mostly counts as
// absent, as mongoose's JSON getters treat it), and the same messages, so
// apps see the same 400s as on a real bar.

import { isObject } from '@busy-bar-apps/json-values';

import type { Bitmap } from '../formats/png.ts';
import { parseXpm, XpmError } from '../formats/xpm.ts';
import type { Rgba } from '../render/canvas.ts';
import { parseColor } from '../render/canvas.ts';
import { ApiError } from './api-error.ts';

export const FONTS = [
  'tiny',
  'small',
  'normal',
  'condensed',
  'bold',
  'large',
  'extra_large',
  'global',
  'superscript',
] as const;
export type FontName = (typeof FONTS)[number];

export const ALIGNS = [
  'top_left',
  'top_mid',
  'top_right',
  'mid_left',
  'center',
  'mid_right',
  'bottom_left',
  'bottom_mid',
  'bottom_right',
] as const;
export type Align = (typeof ALIGNS)[number];

const TYPES = [
  'text',
  'image',
  'animation',
  'rectangle',
  'countdown',
  'xpmbitmap',
] as const;
const DISPLAYS = ['front', 'back'] as const;
const FILLS = ['none', 'solid', 'gradient_h', 'gradient_v'] as const;
const DIRECTIONS = ['time_left', 'time_since'] as const;
const SHOW_HOURS = ['when_non_zero', 'always'] as const;

type DisplayName = (typeof DISPLAYS)[number];

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** The most elements one request, or one app's screen, may hold. */
export const MAX_ELEMENTS = 100;
const DEFAULT_PRIORITY = 50;

/** Where an image, animation, or sound comes from. */
export interface AssetSource {
  readonly kind: 'path' | 'stock';
  readonly path: string;
}

interface Common {
  readonly id: string;
  readonly display: DisplayName;
  readonly x: number;
  readonly y: number;
  readonly align: Align;
  /** Set only when the request names it; see `Screen` for the defaults. */
  readonly zIndex: number | undefined;
  /** Whole seconds after the draw, or undefined. */
  readonly timeout: number | undefined;
  /** Unix time in seconds, or undefined. */
  readonly displayUntil: number | undefined;
}

export interface TextElement extends Common {
  readonly type: 'text';
  readonly text: string;
  readonly font: FontName;
  readonly color: Rgba;
  readonly width: number | undefined;
  /** Pixels per minute; 0 never scrolls. */
  readonly scrollRate: number;
  readonly scrollStartDelay: number;
  readonly scrollRepeatDelay: number;
}

export interface CountdownElement extends Common {
  readonly type: 'countdown';
  /** Unix time in seconds. */
  readonly timestamp: number;
  readonly direction: (typeof DIRECTIONS)[number];
  readonly showHours: (typeof SHOW_HOURS)[number];
  readonly color: Rgba;
}

export interface ImageElement extends Common {
  readonly type: 'image';
  readonly source: AssetSource;
  /** 0 to 255. */
  readonly opacity: number;
}

export interface AnimationElement extends Common {
  readonly type: 'animation';
  readonly source: AssetSource;
  readonly section: string;
  readonly loop: boolean;
  readonly awaitPreviousEnd: boolean;
  /** 0 to 255. */
  readonly opacity: number;
}

export interface RectangleElement extends Common {
  readonly type: 'rectangle';
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fill: (typeof FILLS)[number];
  readonly fillColors: readonly [Rgba, Rgba];
  readonly borderWidth: number;
  readonly borderColor: Rgba;
}

interface XpmElement extends Common {
  readonly type: 'xpmbitmap';
  /** Decoded for the element's display, as the firmware does on parse. */
  readonly bitmap: Bitmap;
  /** 0 to 255. */
  readonly opacity: number;
}

export type Element =
  | TextElement
  | CountdownElement
  | ImageElement
  | AnimationElement
  | RectangleElement
  | XpmElement;

export interface DrawRequest {
  readonly applicationName: string;
  readonly priority: number;
  readonly ledColor: Rgba | undefined;
  readonly elements: readonly Element[];
}

/** What validation needs from the asset store. */
export interface ImageCheck {
  /** The image's size, or undefined when it cannot be found or decoded. */
  imageSize(
    source: AssetSource,
    applicationName: string,
  ): { width: number; height: number } | undefined;
}

/** The display sizes the firmware checks images and bitmaps against. */
const DISPLAY_SIZES: Readonly<
  Record<DisplayName, { width: number; height: number }>
> = {
  front: { width: 72, height: 16 },
  back: { width: 160, height: 80 },
};

/** The stock folder under /ext/apps_assets/shared for each kind of asset. */
export type AssetFolder = 'images' | 'animations' | 'sounds';

/**
 * The file a source names on the bar: an upload under the app's own
 * folder, or a stock file found by the stock path's basename.
 */
export function devicePath(
  source: AssetSource,
  application: string,
  folder: AssetFolder,
): string {
  if (source.kind === 'path') {
    return `/ext/user_assets/${application}/${source.path}`;
  }
  return `/ext/apps_assets/shared/${folder}/${source.path.slice(source.path.lastIndexOf('/') + 1)}`;
}

/** Mongoose's `mg_path_is_sane`: no segment may start with `..`. */
export function isSanePath(path: string): boolean {
  return !path.startsWith('..') && !/[/\\]\.\./u.test(path);
}

/** C's `atoll`: optional space and sign, then digits up to the first other character. */
export function atoll(text: string): number {
  const match = /^\s*([+-]?\d+)/u.exec(text);
  return match === null ? 0 : Number.parseInt(match[1] ?? '0', 10);
}

type Json = Readonly<Record<string, unknown>>;

/**
 * Validate a draw request body. An invalid element rejects the whole
 * request, with its index in the message.
 */
export function parseDrawRequest(
  body: unknown,
  images: ImageCheck,
): DrawRequest {
  const json = new JsonFields(isObject(body) ? body : {});
  const applicationName = json.string('application_name');
  if (applicationName === undefined) {
    throw new ApiError(400, 'Missing application_name');
  }
  const priority = Math.trunc(json.number('priority') ?? DEFAULT_PRIORITY);
  if (priority <= 0) {
    throw new ApiError(400, 'Priority must be >= 1');
  }
  if (priority > 100) {
    throw new ApiError(400, 'Priority must be <= 100');
  }
  let ledColor: Rgba | undefined;
  const led = json.string('led_notification_color');
  if (led !== undefined) {
    ledColor = strictColor(led);
    if (ledColor === undefined) {
      throw new ApiError(400, 'Invalid LED notification color');
    }
  }
  const list = isObject(body) ? body['elements'] : undefined;
  if (!Array.isArray(list)) {
    throw new ApiError(400, 'Missing or invalid elements array');
  }
  const elements: Element[] = [];
  for (const [index, value] of list.entries()) {
    elements.push(parseElement(value, index, applicationName, images));
    if (elements.length > MAX_ELEMENTS) {
      throw new ApiError(400, 'Elements number limit exceeded');
    }
  }
  if (elements.length === 0) {
    throw new ApiError(400, 'Elements array is empty');
  }
  return { applicationName, priority, ledColor, elements };
}

function parseElement(
  value: unknown,
  index: number,
  applicationName: string,
  images: ImageCheck,
): Element {
  const field = new JsonFields(
    isObject(value) ? value : {},
    `elements[${index}]`,
  );
  const id = field.required('id');
  const timeout = field.long('timeout', -1);
  let zIndex: number | undefined;
  if (field.has('z_index')) {
    zIndex = field.long('z_index', -1);
    if (zIndex < 0) {
      throw field.invalid('z_index', 'be >= 0');
    }
  }
  const until = field.string('display_until');
  const displayUntil = until === undefined ? 0 : atoll(until);
  if (timeout > 0 && displayUntil > 0) {
    throw field.error(
      '.{timeout,display_until}: exactly one of these must be present',
    );
  }
  const common: Common = {
    id,
    x: field.long('x', 0),
    y: field.long('y', 0),
    align: field.choice('align', ALIGNS, 'top_left'),
    display: field.choice('display', DISPLAYS, 'front'),
    zIndex,
    timeout: timeout > 0 ? timeout : undefined,
    displayUntil: displayUntil > 0 ? displayUntil : undefined,
  };
  const type = field.required('type');
  switch (type) {
    case 'text':
      return parseText(field, common);
    case 'image':
      return parseImage(field, common, applicationName, images);
    case 'animation':
      return {
        ...common,
        type,
        source: field.source(applicationName),
        section: field.string('section') ?? 'default',
        loop: field.boolean('loop'),
        awaitPreviousEnd: field.boolean('await_previous_end'),
        opacity: field.opacity(),
      };
    case 'rectangle':
      return parseRectangle(field, common);
    case 'countdown':
      return {
        ...common,
        type,
        color: field.color('color', WHITE),
        timestamp: atoll(field.required('timestamp')),
        direction: field.requiredChoice('direction', DIRECTIONS),
        showHours: field.requiredChoice('show_hours', SHOW_HOURS),
      };
    case 'xpmbitmap':
      return parseXpmElement(field, common);
    default:
      throw field.invalid('type', `be one of: ${quoted(TYPES)}`);
  }
}

function parseText(field: JsonFields, common: Common): TextElement {
  const text = field.required('text');
  const fontName = field.required('font');
  const font = FONTS.find((name) => name === fontName);
  if (font === undefined) {
    throw field.invalid('font');
  }
  const color = field.color('color', WHITE);
  const width = field.number('width');
  if (width !== undefined && width < 1) {
    throw field.invalid('width', 'be >= 1');
  }
  return {
    ...common,
    type: 'text',
    text,
    font,
    color,
    width: width === undefined ? undefined : Math.trunc(width),
    scrollRate: field.size('scroll_rate'),
    scrollStartDelay: field.size('scroll_start_delay'),
    scrollRepeatDelay: field.size('scroll_repeat_delay'),
  };
}

function parseImage(
  field: JsonFields,
  common: Common,
  applicationName: string,
  images: ImageCheck,
): ImageElement {
  const opacity = field.opacity();
  const source = field.source(applicationName);
  const path = devicePath(source, applicationName, 'images');
  const size = images.imageSize(source, applicationName);
  if (size === undefined) {
    throw field.error(`: failed to decode image ${path}`);
  }
  const display = DISPLAY_SIZES[common.display];
  if (size.width > display.width || size.height > display.height) {
    throw field.error(
      `: image ${path} exceeds display dimensions ${display.width}x${display.height}.`,
    );
  }
  return { ...common, type: 'image', source, opacity };
}

function parseRectangle(field: JsonFields, common: Common): RectangleElement {
  const width = field.long('width', -1);
  if (width <= 0) {
    throw field.invalid('width', 'be >= 1');
  }
  const height = field.long('height', -1);
  if (height <= 0) {
    throw field.invalid('height', 'be >= 1');
  }
  const fill = field.choice('fill', FILLS, 'none');
  const first = field.listColor(0);
  const second = field.listColor(1);
  if (
    (fill === 'gradient_h' || fill === 'gradient_v') &&
    (first === undefined) !== (second === undefined)
  ) {
    throw field.invalid(
      'fill_colors',
      'have exactly 2 elements with "gradient_X" fill value',
    );
  }
  if (fill === 'solid' && second !== undefined) {
    throw field.invalid(
      'fill_colors',
      'have only one element with "solid" fill value',
    );
  }
  const borderWidth = field.long('border_width', 1);
  if (borderWidth < 0) {
    throw field.invalid('border_width', 'be >= 0');
  }
  const radius = field.long('radius', 0);
  if (radius < 0) {
    throw field.invalid('radius', 'be >= 0');
  }
  return {
    ...common,
    type: 'rectangle',
    width,
    height,
    fill,
    fillColors: [first ?? WHITE, second ?? TRANSPARENT],
    radius,
    borderWidth,
    borderColor: field.color('border_color', WHITE),
  };
}

function parseXpmElement(field: JsonFields, common: Common): XpmElement {
  const opacity = field.opacity();
  const data = field.required('data');
  try {
    const bitmap = parseXpm(
      data,
      common.display,
      DISPLAY_SIZES[common.display],
    );
    return { ...common, type: 'xpmbitmap', bitmap, opacity };
  } catch (error) {
    if (error instanceof XpmError) {
      throw field.invalid('data', error.message);
    }
    throw error;
  }
}

function strictColor(value: string): Rgba | undefined {
  return /^#[0-9a-f]{8}$/iu.test(value) ? parseColor(value) : undefined;
}

function quoted(choices: readonly string[]): string {
  return choices.map((choice) => `"${choice}"`).join(', ');
}

/**
 * Reads one JSON object the way mongoose's getters do: a value of another
 * type counts as absent. Errors carry the element's prefix.
 */
class JsonFields {
  readonly #value: Json;
  readonly #at: string;

  constructor(value: Json, at = '') {
    this.#value = value;
    this.#at = at;
  }

  has(name: string): boolean {
    return this.#value[name] !== undefined;
  }

  string(name: string): string | undefined {
    const value = this.#value[name];
    return typeof value === 'string' ? value : undefined;
  }

  number(name: string): number | undefined {
    const value = this.#value[name];
    return typeof value === 'number' ? value : undefined;
  }

  /** `mg_json_get_long`: a number, truncated, or the fallback. */
  long(name: string, fallback: number): number {
    const value = this.number(name);
    return value === undefined ? fallback : Math.trunc(value);
  }

  boolean(name: string): boolean {
    return this.#value[name] === true;
  }

  required(name: string): string {
    const value = this.string(name);
    if (value === undefined) {
      throw this.error(`.${name} is required`);
    }
    return value;
  }

  choice<const T extends string>(
    name: string,
    choices: readonly T[],
    fallback: T,
  ): T {
    const value = this.string(name);
    return value === undefined ? fallback : this.#pick(name, choices, value);
  }

  requiredChoice<const T extends string>(
    name: string,
    choices: readonly T[],
  ): T {
    return this.#pick(name, choices, this.required(name));
  }

  /** A count the firmware stores as `size_t`: negative is refused. */
  size(name: string): number {
    const value = this.number(name);
    if (value === undefined) {
      return 0;
    }
    if (value < -Number.EPSILON) {
      throw this.invalid(name, 'be >= 0');
    }
    return Math.max(0, Math.trunc(value));
  }

  /** An opacity percentage, as 0 to 255 like the firmware stores it. */
  opacity(): number {
    const percent = this.long('opacity', 100);
    if (percent < 0 || percent > 100) {
      throw this.invalid('opacity', 'be in range [0; 100]');
    }
    return Math.floor((percent * 255) / 100);
  }

  color(name: string, fallback: Rgba): Rgba {
    const value = this.string(name);
    if (value === undefined) {
      return fallback;
    }
    const color = strictColor(value);
    if (color === undefined) {
      throw this.invalid(name, 'be in #RRGGBBAA format');
    }
    return color;
  }

  /** `fill_colors[index]`, when it holds a string. */
  listColor(index: number): Rgba | undefined {
    const list = this.#value['fill_colors'];
    const value: unknown = Array.isArray(list) ? list[index] : undefined;
    if (typeof value !== 'string') {
      return undefined;
    }
    const color = strictColor(value);
    if (color === undefined) {
      throw this.invalid(`fill_colors[${index}]`, 'be in #RRGGBBAA format');
    }
    return color;
  }

  /** `path` or `stock_path`, exactly one, checked like the firmware does. */
  source(application: string): AssetSource {
    const path = this.string('path');
    const stock = this.string('stock_path');
    const either = '.{path,stock_path}: exactly one of these must be present';
    if (path !== undefined && stock !== undefined) {
      throw this.error(either);
    }
    if (path !== undefined) {
      if (!isSanePath(`/ext/user_assets/${application}/${path}`)) {
        throw this.invalid('path', 'be clean, without path escape sequences');
      }
      return { kind: 'path', path };
    }
    if (stock !== undefined) {
      const slash = stock.lastIndexOf('/');
      if (slash === -1 || slash === stock.length - 1) {
        throw this.invalid('stock_path');
      }
      return { kind: 'stock', path: stock };
    }
    throw this.error(either);
  }

  error(message: string): ApiError {
    return new ApiError(400, `${this.#at}${message}`);
  }

  invalid(name: string, rule?: string): ApiError {
    return this.error(
      rule === undefined
        ? `.${name} value is invalid`
        : `.${name} value is invalid; must ${rule}`,
    );
  }

  #pick<const T extends string>(
    name: string,
    choices: readonly T[],
    value: string,
  ): T {
    const match = choices.find((choice) => choice === value);
    if (match === undefined) {
      throw this.invalid(name, `be one of: ${quoted(choices)}`);
    }
    return match;
  }
}
