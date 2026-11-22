import { describe, expect, it } from 'vitest';

import type { Rgba } from '../render/canvas.ts';
import { WHITE } from '../render/canvas.ts';
import { ApiError } from './api-error.ts';
import type { DrawRequest, Element, ImageCheck } from './elements.ts';
import {
  ALIGNS,
  atoll,
  devicePath,
  FONTS,
  isSanePath,
  MAX_ELEMENTS,
  parseDrawRequest,
} from './elements.ts';

type Json = Readonly<Record<string, unknown>>;

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };
const RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: Rgba = { r: 0, g: 255, b: 0, a: 255 };

// What the asset store reports for each device path the tests name.
const IMAGE_SIZES = new Map([
  ['/ext/apps_assets/shared/images/dot.image', { width: 2, height: 2 }],
  ['/ext/apps_assets/shared/images/wide.image', { width: 80, height: 4 }],
  ['/ext/user_assets/app/full.png', { width: 72, height: 16 }],
  ['/ext/user_assets/app/tall.png', { width: 8, height: 17 }],
  ['/ext/user_assets/app/huge.png', { width: 161, height: 1 }],
  ['/ext/user_assets/app/a..b.png', { width: 1, height: 1 }],
]);

const IMAGES: ImageCheck = {
  imageSize: (source, application) =>
    IMAGE_SIZES.get(devicePath(source, application, 'images')),
};

const TEXT: Json = { id: 'label', type: 'text', text: 'Hi', font: 'normal' };

function parse(body: unknown): DrawRequest {
  return parseDrawRequest(body, IMAGES);
}

/** A request from "app" holding `elements`, plus any top-level fields. */
function body(elements: unknown, fields: Json = {}): Json {
  return { application_name: 'app', elements, ...fields };
}

/** The element a one-element request parses to. */
function element(fields: Json): Element {
  const [parsed] = parse(body([fields])).elements;
  if (parsed === undefined) {
    throw new Error('The request parsed to no elements.');
  }
  return parsed;
}

interface Refusal {
  readonly status: number;
  readonly message: string;
}

/** The answer `parseDrawRequest` refuses a body with. */
function refusal(request: unknown): Refusal {
  try {
    parse(request);
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: error.status, message: error.message };
    }
    throw error;
  }
  throw new Error('The request parsed.');
}

/** The answer a one-element request is refused with. */
function invalid(fields: Json): Refusal {
  return refusal(body([fields]));
}

function badRequest(message: string): Refusal {
  return { status: 400, message };
}

/** An XPM2 bitmap `width` pixels wide and one pixel tall. */
function xpm(width: number): string {
  return ['! XPM2', `${width} 1 1 1`, 'a c red', 'a'.repeat(width)].join('\n');
}

describe('devicePath', () => {
  it('puts uploads in the app folder and finds stock files by basename', () => {
    expect(
      devicePath({ kind: 'path', path: 'icons/logo.png' }, 'clock', 'images'),
    ).toBe('/ext/user_assets/clock/icons/logo.png');
    expect(
      devicePath({ kind: 'path', path: 'tone.pcm' }, 'clock', 'sounds'),
    ).toBe('/ext/user_assets/clock/tone.pcm');
    expect(
      devicePath(
        { kind: 'stock', path: 'shared/dot.image' },
        'clock',
        'images',
      ),
    ).toBe('/ext/apps_assets/shared/images/dot.image');
    expect(
      devicePath(
        { kind: 'stock', path: 'any/folder/spin.anim' },
        'clock',
        'animations',
      ),
    ).toBe('/ext/apps_assets/shared/animations/spin.anim');
    expect(
      devicePath({ kind: 'stock', path: '/beep.snd' }, 'clock', 'sounds'),
    ).toBe('/ext/apps_assets/shared/sounds/beep.snd');
  });
});

describe('isSanePath', () => {
  it.each([
    ['/ext/user_assets/app/logo.png', true],
    ['/ext/user_assets/app/a..b.png', true],
    ['/ext/user_assets/app/.hidden/logo.png', true],
    ['..', false],
    ['../logo.png', false],
    ['/ext/user_assets/app/../other/logo.png', false],
    ['/ext/user_assets/app/..logo.png', false],
    ['/ext/user_assets/app/..', false],
    ['/ext/user_assets/app\\..\\logo.png', false],
  ])('judges %j sane: %j', (path, sane) => {
    expect(isSanePath(path)).toBe(sane);
  });
});

describe('atoll', () => {
  it.each([
    ['1700000000', 1_700_000_000],
    ['  42', 42],
    ['\t+7', 7],
    ['-15', -15],
    ['12.9', 12],
    ['99 bottles', 99],
    ['0x10', 0],
    ['', 0],
    ['soon', 0],
    ['- 5', 0],
  ])('reads %j as %d', (text, value) => {
    expect(atoll(text)).toBe(value);
  });
});

describe('parseDrawRequest', () => {
  describe('the request', () => {
    it('reads a minimal request with the firmware defaults', () => {
      expect(parse(body([TEXT]))).toStrictEqual({
        applicationName: 'app',
        priority: 50,
        ledColor: undefined,
        elements: [
          {
            id: 'label',
            type: 'text',
            display: 'front',
            x: 0,
            y: 0,
            align: 'top_left',
            zIndex: undefined,
            timeout: undefined,
            displayUntil: undefined,
            text: 'Hi',
            font: 'normal',
            color: WHITE,
            width: undefined,
            scrollRate: 0,
            scrollStartDelay: 0,
            scrollRepeatDelay: 0,
          },
        ],
      });
    });

    it.each([
      ['a body without one', { elements: [TEXT] }],
      [
        'a name that is not a string',
        { application_name: 7, elements: [TEXT] },
      ],
      ['a null body', null],
      ['a string body', 'app'],
      ['an array body', [{ application_name: 'app', elements: [TEXT] }]],
    ])('needs an application name: refuses %s', (_label, request) => {
      expect(refusal(request)).toStrictEqual(
        badRequest('Missing application_name'),
      );
    });

    it('accepts an empty application name', () => {
      expect(
        parse(body([TEXT], { application_name: '' })).applicationName,
      ).toBe('');
    });

    it.each([
      [1, 1],
      [100, 100],
      [7.9, 7],
      [100.9, 100],
      ['80', 50],
      [null, 50],
    ])('reads priority %j as %d', (priority, expected) => {
      expect(parse(body([TEXT], { priority })).priority).toBe(expected);
    });

    it.each([
      [0, 'Priority must be >= 1'],
      [0.9, 'Priority must be >= 1'],
      [-0.5, 'Priority must be >= 1'],
      [-3, 'Priority must be >= 1'],
      [101, 'Priority must be <= 100'],
    ])('refuses priority %j', (priority, message) => {
      expect(refusal(body([TEXT], { priority }))).toStrictEqual(
        badRequest(message),
      );
    });

    it('reads a strict #RRGGBBAA LED colour and ignores other types', () => {
      expect(
        parse(body([TEXT], { led_notification_color: '#ff800040' })).ledColor,
      ).toStrictEqual({ r: 255, g: 128, b: 0, a: 64 });
      expect(
        parse(body([TEXT], { led_notification_color: 0xff0000ff })).ledColor,
      ).toBeUndefined();
    });

    it.each(['#FF8000', 'orange', '#FF800040FF', 'FF800040', '#GG800040'])(
      'refuses the LED colour %j',
      (color) => {
        expect(
          refusal(body([TEXT], { led_notification_color: color })),
        ).toStrictEqual(badRequest('Invalid LED notification color'));
      },
    );

    it('checks the request fields in the firmware order', () => {
      expect(
        refusal({ priority: 0, led_notification_color: 'x', elements: 1 }),
      ).toStrictEqual(badRequest('Missing application_name'));
      expect(
        refusal(body(1, { priority: 0, led_notification_color: 'x' })),
      ).toStrictEqual(badRequest('Priority must be >= 1'));
      expect(refusal(body(1, { led_notification_color: 'x' }))).toStrictEqual(
        badRequest('Invalid LED notification color'),
      );
    });

    it.each([
      ['no elements', undefined],
      ['an object', {}],
      ['a string', '[]'],
      ['a number', 3],
    ])('needs an elements array: refuses %s', (_label, elements) => {
      expect(refusal(body(elements))).toStrictEqual(
        badRequest('Missing or invalid elements array'),
      );
    });

    it('refuses an empty elements array', () => {
      expect(refusal(body([]))).toStrictEqual(
        badRequest('Elements array is empty'),
      );
    });

    it('takes 100 elements and refuses a 101st valid one', () => {
      const texts = (count: number): Json[] =>
        Array.from({ length: count }, (_, index) => ({
          ...TEXT,
          id: `t${index}`,
        }));

      expect(parse(body(texts(MAX_ELEMENTS))).elements).toHaveLength(100);
      expect(refusal(body(texts(MAX_ELEMENTS + 1)))).toStrictEqual(
        badRequest('Elements number limit exceeded'),
      );
      // A bad 101st element reports its own error, as it fails first.
      expect(
        refusal(body([...texts(MAX_ELEMENTS), { type: 'text' }])),
      ).toStrictEqual(badRequest('elements[100].id is required'));
    });

    it('prefixes element errors with their index', () => {
      expect(refusal(body([TEXT, { ...TEXT, id: 3 }]))).toStrictEqual(
        badRequest('elements[1].id is required'),
      );
      expect(refusal(body(['text']))).toStrictEqual(
        badRequest('elements[0].id is required'),
      );
      expect(refusal(body([null]))).toStrictEqual(
        badRequest('elements[0].id is required'),
      );
    });
  });

  describe('common element fields', () => {
    it('truncates the position and reads the alignment and display', () => {
      expect(
        element({
          ...TEXT,
          x: 3.9,
          y: -2.5,
          align: 'bottom_right',
          display: 'back',
        }),
      ).toMatchObject({ x: 3, y: -2, align: 'bottom_right', display: 'back' });
      expect(
        element({ ...TEXT, x: '3', y: null, align: 5, display: true }),
      ).toMatchObject({ x: 0, y: 0, align: 'top_left', display: 'front' });
    });

    it.each(ALIGNS)('accepts the alignment %s', (align) => {
      expect(element({ ...TEXT, align }).align).toBe(align);
    });

    it.each([
      [5, 5],
      [5.8, 5],
      [0.5, undefined],
      [0, undefined],
      [-3, undefined],
      ['5', undefined],
    ])('reads timeout %j as %j', (timeout, expected) => {
      expect(element({ ...TEXT, timeout }).timeout).toBe(expected);
    });

    it('reads z_index as a truncated number', () => {
      expect(element({ ...TEXT, z_index: 3.7 }).zIndex).toBe(3);
      expect(element({ ...TEXT, z_index: 0 }).zIndex).toBe(0);
      expect(element(TEXT).zIndex).toBeUndefined();
    });

    it.each([-1, '3', null, true])('refuses z_index %j', (zIndex) => {
      expect(invalid({ ...TEXT, z_index: zIndex })).toStrictEqual(
        badRequest('elements[0].z_index value is invalid; must be >= 0'),
      );
    });

    it.each([
      ['1700000000', 1_700_000_000],
      [' 1700000000.5', 1_700_000_000],
      ['0', undefined],
      ['-5', undefined],
      ['soon', undefined],
      [1_700_000_000, undefined],
    ])('reads display_until %j as %j', (until, expected) => {
      expect(element({ ...TEXT, display_until: until }).displayUntil).toBe(
        expected,
      );
    });

    it('refuses a timeout together with a display_until', () => {
      expect(
        invalid({ ...TEXT, timeout: 5, display_until: '1700000000' }),
      ).toStrictEqual(
        badRequest(
          'elements[0].{timeout,display_until}: exactly one of these must be present',
        ),
      );
      expect(
        element({ ...TEXT, timeout: 0, display_until: '1700000000' }),
      ).toMatchObject({ timeout: undefined, displayUntil: 1_700_000_000 });
      expect(
        element({ ...TEXT, timeout: 5, display_until: '0' }),
      ).toMatchObject({ timeout: 5, displayUntil: undefined });
      expect(
        element({ ...TEXT, timeout: 5, display_until: 1_700_000_000 }),
      ).toMatchObject({ timeout: 5, displayUntil: undefined });
    });

    it('refuses an unknown alignment, display, or type, listing the choices', () => {
      expect(invalid({ ...TEXT, align: 'middle' })).toStrictEqual(
        badRequest(
          'elements[0].align value is invalid; must be one of: "top_left", "top_mid", "top_right", "mid_left", "center", "mid_right", "bottom_left", "bottom_mid", "bottom_right"',
        ),
      );
      expect(invalid({ ...TEXT, display: 'side' })).toStrictEqual(
        badRequest(
          'elements[0].display value is invalid; must be one of: "front", "back"',
        ),
      );
      expect(invalid({ ...TEXT, type: 'circle' })).toStrictEqual(
        badRequest(
          'elements[0].type value is invalid; must be one of: "text", "image", "animation", "rectangle", "countdown", "xpmbitmap"',
        ),
      );
      expect(invalid({ id: 'a', type: 7 })).toStrictEqual(
        badRequest('elements[0].type is required'),
      );
    });

    it('checks the common fields in the firmware order', () => {
      const bad = {
        type: 'circle',
        z_index: -1,
        timeout: 1,
        display_until: '9',
        align: 'middle',
        display: 'side',
      };

      expect(invalid(bad).message).toBe('elements[0].id is required');
      expect(invalid({ ...bad, id: 'a' }).message).toBe(
        'elements[0].z_index value is invalid; must be >= 0',
      );
      expect(invalid({ ...bad, id: 'a', z_index: 1 }).message).toBe(
        'elements[0].{timeout,display_until}: exactly one of these must be present',
      );
      expect(
        invalid({ ...bad, id: 'a', z_index: 1, timeout: 0 }).message,
      ).toMatch(/^elements\[0\]\.align value is invalid/u);
      expect(
        invalid({ ...bad, id: 'a', z_index: 1, timeout: 0, align: 'center' })
          .message,
      ).toMatch(/^elements\[0\]\.display value is invalid/u);
      expect(
        invalid({
          ...bad,
          id: 'a',
          z_index: 1,
          timeout: 0,
          align: 'center',
          display: 'back',
        }).message,
      ).toMatch(/^elements\[0\]\.type value is invalid/u);
    });
  });

  describe('text elements', () => {
    it.each(FONTS)('accepts the %s font', (font) => {
      expect(element({ ...TEXT, font })).toMatchObject({ type: 'text', font });
    });

    it('reads the colour, width, and scrolling, truncating numbers', () => {
      expect(
        element({
          ...TEXT,
          color: '#00ff0080',
          width: 10.7,
          scroll_rate: 60.9,
          scroll_start_delay: 1000,
          scroll_repeat_delay: 2.5,
        }),
      ).toMatchObject({
        color: { r: 0, g: 255, b: 0, a: 128 },
        width: 10,
        scrollRate: 60,
        scrollStartDelay: 1000,
        scrollRepeatDelay: 2,
      });
    });

    it('ignores fields of the wrong type and rounding-error negatives', () => {
      expect(
        element({
          ...TEXT,
          color: 0xffffffff,
          width: '10',
          scroll_rate: '60',
          scroll_start_delay: -1e-17,
        }),
      ).toMatchObject({
        color: WHITE,
        width: undefined,
        scrollRate: 0,
        scrollStartDelay: 0,
      });
    });

    it.each([
      ['a missing text', { text: undefined }, 'elements[0].text is required'],
      [
        'a text that is not a string, before the font',
        { text: 5, font: 'huge' },
        'elements[0].text is required',
      ],
      ['a missing font', { font: undefined }, 'elements[0].font is required'],
      [
        'an unknown font, without listing the fonts',
        { font: 'huge', color: 'red' },
        'elements[0].font value is invalid',
      ],
      [
        'a colour without alpha, before the width',
        { color: '#00FF00', width: 0 },
        'elements[0].color value is invalid; must be in #RRGGBBAA format',
      ],
      [
        'a width below 1, before the scrolling',
        { width: 0.5, scroll_rate: -1 },
        'elements[0].width value is invalid; must be >= 1',
      ],
      [
        'a negative scroll rate, before the delays',
        { scroll_rate: -1, scroll_start_delay: -1 },
        'elements[0].scroll_rate value is invalid; must be >= 0',
      ],
      [
        'a negative start delay, before the repeat delay',
        { scroll_start_delay: -0.001, scroll_repeat_delay: -1 },
        'elements[0].scroll_start_delay value is invalid; must be >= 0',
      ],
      [
        'a negative repeat delay',
        { scroll_repeat_delay: -5 },
        'elements[0].scroll_repeat_delay value is invalid; must be >= 0',
      ],
    ])('refuses %s', (_label, fields, message) => {
      expect(invalid({ ...TEXT, ...fields })).toStrictEqual(
        badRequest(message),
      );
    });
  });

  describe('countdown elements', () => {
    const COUNTDOWN: Json = {
      id: 'left',
      type: 'countdown',
      timestamp: '1700000000',
      direction: 'time_left',
      show_hours: 'always',
    };

    it('reads the timestamp with atoll, the direction, and the hours', () => {
      expect(element(COUNTDOWN)).toMatchObject({
        type: 'countdown',
        timestamp: 1_700_000_000,
        direction: 'time_left',
        showHours: 'always',
        color: WHITE,
      });
      expect(
        element({
          ...COUNTDOWN,
          timestamp: '17 seconds',
          direction: 'time_since',
          show_hours: 'when_non_zero',
          color: '#FF0000FF',
        }),
      ).toMatchObject({
        timestamp: 17,
        direction: 'time_since',
        showHours: 'when_non_zero',
        color: RED,
      });
    });

    it.each([
      [
        'a bad colour, before the timestamp',
        { color: 'red', timestamp: undefined },
        'elements[0].color value is invalid; must be in #RRGGBBAA format',
      ],
      [
        'a timestamp that is not a string, before the direction',
        { timestamp: 1_700_000_000, direction: 'up' },
        'elements[0].timestamp is required',
      ],
      [
        'a missing direction, before the hours',
        { direction: undefined, show_hours: 'never' },
        'elements[0].direction is required',
      ],
      [
        'an unknown direction, before the hours',
        { direction: 'up', show_hours: 'never' },
        'elements[0].direction value is invalid; must be one of: "time_left", "time_since"',
      ],
      [
        'hours that are not a string',
        { show_hours: true },
        'elements[0].show_hours is required',
      ],
      [
        'unknown hours',
        { show_hours: 'never' },
        'elements[0].show_hours value is invalid; must be one of: "when_non_zero", "always"',
      ],
    ])('refuses %s', (_label, fields, message) => {
      expect(invalid({ ...COUNTDOWN, ...fields })).toStrictEqual(
        badRequest(message),
      );
    });
  });

  describe('image elements', () => {
    const IMAGE: Json = {
      id: 'pic',
      type: 'image',
      stock_path: 'shared/dot.image',
    };

    it('reads a stock image at full opacity', () => {
      expect(element(IMAGE)).toMatchObject({
        type: 'image',
        source: { kind: 'stock', path: 'shared/dot.image' },
        opacity: 255,
      });
    });

    it('reads an upload, and a stock path with only a leading slash', () => {
      expect(
        element({ id: 'pic', type: 'image', path: 'full.png' }),
      ).toMatchObject({ source: { kind: 'path', path: 'full.png' } });
      expect(
        element({ ...IMAGE, path: 5, stock_path: '/dot.image' }),
      ).toMatchObject({ source: { kind: 'stock', path: '/dot.image' } });
    });

    it.each([
      [0, 0],
      [1, 2],
      [50, 127],
      [33.9, 84],
      [100, 255],
      ['50', 255],
    ])('stores opacity %j as %d of 255', (opacity, stored) => {
      expect(element({ ...IMAGE, opacity })).toMatchObject({ opacity: stored });
    });

    it.each([
      [
        'an opacity below 0, before the source',
        { opacity: -1, stock_path: undefined },
        'elements[0].opacity value is invalid; must be in range [0; 100]',
      ],
      [
        'an opacity above 100',
        { opacity: 101 },
        'elements[0].opacity value is invalid; must be in range [0; 100]',
      ],
      [
        'both a path and a stock path',
        { path: 'full.png' },
        'elements[0].{path,stock_path}: exactly one of these must be present',
      ],
      [
        'neither a path nor a stock path',
        { stock_path: undefined },
        'elements[0].{path,stock_path}: exactly one of these must be present',
      ],
      [
        'a stock path without a folder',
        { stock_path: 'dot.image' },
        'elements[0].stock_path value is invalid',
      ],
      [
        'a stock path without a file name',
        { stock_path: 'shared/' },
        'elements[0].stock_path value is invalid',
      ],
    ])('refuses %s', (_label, fields, message) => {
      expect(invalid({ ...IMAGE, ...fields })).toStrictEqual(
        badRequest(message),
      );
    });

    it.each(['../other/full.png', 'icons/../../full.png', '..full.png', '..'])(
      'refuses the escaping path %j',
      (path) => {
        expect(invalid({ id: 'pic', type: 'image', path })).toStrictEqual(
          badRequest(
            'elements[0].path value is invalid; must be clean, without path escape sequences',
          ),
        );
      },
    );

    it('checks the whole device path, app name included, for escapes', () => {
      expect(
        element({ id: 'pic', type: 'image', path: 'a..b.png' }),
      ).toMatchObject({ source: { kind: 'path', path: 'a..b.png' } });
      expect(
        refusal({
          application_name: '..',
          elements: [{ id: 'pic', type: 'image', path: 'full.png' }],
        }),
      ).toStrictEqual(
        badRequest(
          'elements[0].path value is invalid; must be clean, without path escape sequences',
        ),
      );
    });

    it('refuses an image the bar cannot decode, naming its device path', () => {
      expect(
        invalid({ id: 'pic', type: 'image', path: 'missing.png' }),
      ).toStrictEqual(
        badRequest(
          'elements[0]: failed to decode image /ext/user_assets/app/missing.png',
        ),
      );
      expect(invalid({ ...IMAGE, stock_path: 'shared/dot.png' })).toStrictEqual(
        badRequest(
          'elements[0]: failed to decode image /ext/apps_assets/shared/images/dot.png',
        ),
      );
    });

    it('refuses an image larger than its display', () => {
      expect(
        invalid({ ...IMAGE, stock_path: 'shared/wide.image' }),
      ).toStrictEqual(
        badRequest(
          'elements[0]: image /ext/apps_assets/shared/images/wide.image exceeds display dimensions 72x16.',
        ),
      );
      expect(
        invalid({ id: 'pic', type: 'image', path: 'tall.png' }),
      ).toStrictEqual(
        badRequest(
          'elements[0]: image /ext/user_assets/app/tall.png exceeds display dimensions 72x16.',
        ),
      );
      expect(
        invalid({
          id: 'pic',
          type: 'image',
          path: 'huge.png',
          display: 'back',
        }),
      ).toStrictEqual(
        badRequest(
          'elements[0]: image /ext/user_assets/app/huge.png exceeds display dimensions 160x80.',
        ),
      );
    });

    it('accepts images up to the size of their display', () => {
      expect(
        element({ id: 'pic', type: 'image', path: 'full.png' }).display,
      ).toBe('front');
      expect(
        element({ ...IMAGE, stock_path: 'shared/wide.image', display: 'back' })
          .display,
      ).toBe('back');
      expect(
        element({ id: 'pic', type: 'image', path: 'tall.png', display: 'back' })
          .display,
      ).toBe('back');
    });
  });

  describe('animation elements', () => {
    const ANIMATION: Json = {
      id: 'spin',
      type: 'animation',
      stock_path: 'shared/spin.anim',
    };

    it('plays the default section once by default', () => {
      expect(element(ANIMATION)).toStrictEqual({
        id: 'spin',
        type: 'animation',
        display: 'front',
        x: 0,
        y: 0,
        align: 'top_left',
        zIndex: undefined,
        timeout: undefined,
        displayUntil: undefined,
        source: { kind: 'stock', path: 'shared/spin.anim' },
        section: 'default',
        loop: false,
        awaitPreviousEnd: false,
        opacity: 255,
      });
    });

    it('reads the section, and the flags only when they are true', () => {
      expect(
        element({
          ...ANIMATION,
          section: 'intro',
          loop: true,
          await_previous_end: true,
          opacity: 40,
        }),
      ).toMatchObject({
        section: 'intro',
        loop: true,
        awaitPreviousEnd: true,
        opacity: 102,
      });
      expect(
        element({
          ...ANIMATION,
          section: 5,
          loop: 1,
          await_previous_end: 'true',
        }),
      ).toMatchObject({
        section: 'default',
        loop: false,
        awaitPreviousEnd: false,
      });
    });

    it('checks the source before the opacity, without opening the file', () => {
      expect(
        invalid({ ...ANIMATION, stock_path: undefined, opacity: 101 }),
      ).toStrictEqual(
        badRequest(
          'elements[0].{path,stock_path}: exactly one of these must be present',
        ),
      );
      expect(invalid({ ...ANIMATION, opacity: 101 })).toStrictEqual(
        badRequest(
          'elements[0].opacity value is invalid; must be in range [0; 100]',
        ),
      );
      expect(
        element({ id: 'spin', type: 'animation', path: 'missing.anim' }),
      ).toMatchObject({ source: { kind: 'path', path: 'missing.anim' } });
    });
  });

  describe('rectangle elements', () => {
    const RECTANGLE: Json = {
      id: 'box',
      type: 'rectangle',
      width: 10,
      height: 4,
    };

    it('reads a rectangle with the firmware defaults', () => {
      expect(element(RECTANGLE)).toMatchObject({
        type: 'rectangle',
        width: 10,
        height: 4,
        fill: 'none',
        fillColors: [WHITE, TRANSPARENT],
        borderWidth: 1,
        radius: 0,
        borderColor: WHITE,
      });
    });

    it('truncates the size, border width, and radius', () => {
      expect(
        element({
          ...RECTANGLE,
          width: 10.9,
          height: 4.2,
          border_width: 2.5,
          radius: 3.9,
        }),
      ).toMatchObject({ width: 10, height: 4, borderWidth: 2, radius: 3 });
    });

    it('reads the fill and its colours', () => {
      expect(
        element({ ...RECTANGLE, fill: 'solid', fill_colors: ['#FF0000FF'] }),
      ).toMatchObject({ fill: 'solid', fillColors: [RED, TRANSPARENT] });
      expect(
        element({
          ...RECTANGLE,
          fill: 'gradient_h',
          fill_colors: ['#FF0000FF', '#00FF00FF'],
        }),
      ).toMatchObject({ fill: 'gradient_h', fillColors: [RED, GREEN] });
      // A gradient without colours falls back to white and transparent.
      expect(element({ ...RECTANGLE, fill: 'gradient_v' })).toMatchObject({
        fill: 'gradient_v',
        fillColors: [WHITE, TRANSPARENT],
      });
      // Entries that are not strings count as absent; "none" takes any.
      expect(
        element({ ...RECTANGLE, fill_colors: [7, '#00FF00FF'] }),
      ).toMatchObject({ fill: 'none', fillColors: [WHITE, GREEN] });
      expect(
        element({ ...RECTANGLE, fill: 'solid', fill_colors: '#FF0000FF' }),
      ).toMatchObject({ fillColors: [WHITE, TRANSPARENT] });
      expect(
        element({ ...RECTANGLE, border_width: 0, border_color: '#0000FF80' }),
      ).toMatchObject({
        borderWidth: 0,
        borderColor: { r: 0, g: 0, b: 255, a: 128 },
      });
    });

    it.each([
      [
        'a zero width, before the height',
        { width: 0, height: 0 },
        'elements[0].width value is invalid; must be >= 1',
      ],
      [
        'a width that truncates to 0',
        { width: 0.9 },
        'elements[0].width value is invalid; must be >= 1',
      ],
      [
        'a width that is not a number',
        { width: '10' },
        'elements[0].width value is invalid; must be >= 1',
      ],
      [
        'a missing width',
        { width: undefined },
        'elements[0].width value is invalid; must be >= 1',
      ],
      [
        'a negative height',
        { height: -2 },
        'elements[0].height value is invalid; must be >= 1',
      ],
      [
        'a missing height',
        { height: undefined },
        'elements[0].height value is invalid; must be >= 1',
      ],
      [
        'an unknown fill, before the colours',
        { fill: 'pattern', fill_colors: ['red'] },
        'elements[0].fill value is invalid; must be one of: "none", "solid", "gradient_h", "gradient_v"',
      ],
      [
        'a bad first colour, before the border',
        { fill_colors: ['red', 'blue'], border_width: -1 },
        'elements[0].fill_colors[0] value is invalid; must be in #RRGGBBAA format',
      ],
      [
        'a bad second colour, before the fill rules',
        { fill: 'solid', fill_colors: ['#FF0000FF', '#00FF00'] },
        'elements[0].fill_colors[1] value is invalid; must be in #RRGGBBAA format',
      ],
      [
        'two colours for a solid fill',
        { fill: 'solid', fill_colors: ['#FF0000FF', '#00FF00FF'] },
        'elements[0].fill_colors value is invalid; must have only one element with "solid" fill value',
      ],
      [
        'a second colour alone for a solid fill',
        { fill: 'solid', fill_colors: [null, '#00FF00FF'] },
        'elements[0].fill_colors value is invalid; must have only one element with "solid" fill value',
      ],
      [
        'one colour for a gradient',
        { fill: 'gradient_h', fill_colors: ['#FF0000FF'] },
        'elements[0].fill_colors value is invalid; must have exactly 2 elements with "gradient_X" fill value',
      ],
      [
        'a gradient whose first colour is not a string',
        { fill: 'gradient_v', fill_colors: [7, '#00FF00FF'] },
        'elements[0].fill_colors value is invalid; must have exactly 2 elements with "gradient_X" fill value',
      ],
      [
        'a negative border width, before the radius',
        { border_width: -1, radius: -1 },
        'elements[0].border_width value is invalid; must be >= 0',
      ],
      [
        'a negative radius, before the border colour',
        { radius: -1, border_color: 'white' },
        'elements[0].radius value is invalid; must be >= 0',
      ],
      [
        'a bad border colour',
        { border_color: 'white' },
        'elements[0].border_color value is invalid; must be in #RRGGBBAA format',
      ],
    ])('refuses %s', (_label, fields, message) => {
      expect(invalid({ ...RECTANGLE, ...fields })).toStrictEqual(
        badRequest(message),
      );
    });
  });

  describe('xpmbitmap elements', () => {
    const DATA = ['! XPM2', '2 1 2 1', 'a c #FF0000', 'b c None', 'ab'].join(
      '\n',
    );

    it('decodes the bitmap for its display', () => {
      expect(
        element({ id: 'bits', type: 'xpmbitmap', data: DATA, opacity: 50 }),
      ).toMatchObject({
        type: 'xpmbitmap',
        opacity: 127,
        bitmap: {
          width: 2,
          height: 1,
          rgba: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]),
        },
      });
      // The greyscale back display takes red's luma, (77 * 255) >> 8.
      expect(
        element({ id: 'bits', type: 'xpmbitmap', data: DATA, display: 'back' }),
      ).toMatchObject({
        opacity: 255,
        bitmap: { rgba: Uint8Array.from([76, 76, 76, 255, 0, 0, 0, 0]) },
      });
      expect(
        element({
          id: 'bits',
          type: 'xpmbitmap',
          data: xpm(73),
          display: 'back',
        }),
      ).toMatchObject({ bitmap: { width: 73, height: 1 } });
    });

    it.each([
      [
        'an opacity above 100, before the data',
        { opacity: 101 },
        'elements[0].opacity value is invalid; must be in range [0; 100]',
      ],
      ['missing data', {}, 'elements[0].data is required'],
      [
        'data that is not a string',
        { data: 7 },
        'elements[0].data is required',
      ],
      [
        'data without the XPM2 header',
        { data: 'XPM2\n1 1 1 1\na c red\na' },
        'elements[0].data value is invalid; must have valid XPM header',
      ],
      [
        'a bitmap wider than the front display',
        { data: xpm(73) },
        'elements[0].data value is invalid; must be no larger than the display (72x16)',
      ],
      [
        'a bitmap wider than the back display',
        { data: xpm(161), display: 'back' },
        'elements[0].data value is invalid; must be no larger than the display (160x80)',
      ],
    ])('refuses %s', (_label, fields, message) => {
      expect(
        invalid({ id: 'bits', type: 'xpmbitmap', ...fields }),
      ).toStrictEqual(badRequest(message));
    });
  });
});
