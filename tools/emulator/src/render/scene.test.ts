import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AssetRoot } from '../__tests__/asset-root.ts';
import { assetRoot } from '../__tests__/asset-root.ts';
import type { AssetLibrary } from '../assets/library.ts';
import { AnimationPlayer } from '../device/animation-player.ts';
import { Device } from '../device/device.ts';
import type {
  Align,
  CountdownElement,
  Element,
  FontName,
  ImageElement,
} from '../device/elements.ts';
import { parseDrawRequest } from '../device/elements.ts';
import type { PlacedElement } from '../device/screen.ts';
import type { Animation } from '../formats/animation.ts';
import { Canvas } from './canvas.ts';
import type { Frames, SceneAssets } from './scene.ts';
import { anchor, countdownText, coverageAt, SceneRenderer } from './scene.ts';

/** Milliseconds since the epoch: 1,000,000 whole seconds. */
const NOW = 1_000_000_000;

let root: AssetRoot;
let library: AssetLibrary;
let renderer: SceneRenderer;

beforeAll(async () => {
  root = await assetRoot();
  library = await root.open();
  renderer = new SceneRenderer(library);
});

afterAll(async () => {
  await root.cleanup();
});

/** Elements as `POST /api/display/draw` parses them for the app `app`. */
function parse(...elements: Record<string, unknown>[]): Element[] {
  return [
    ...parseDrawRequest({ application_name: 'app', elements }, library)
      .elements,
  ];
}

function one(fields: Record<string, unknown>): Element {
  const [element] = parse(fields);
  if (element === undefined) {
    throw new Error('The request parsed to no element.');
  }
  return element;
}

function placed(
  element: Element,
  overrides: Partial<PlacedElement> = {},
): PlacedElement {
  return {
    element,
    z: 0,
    expiresAt: undefined,
    since: 0,
    player: undefined,
    ...overrides,
  };
}

/** Render an open canvas of the app `app` holding `items`, bottom first. */
function draw(
  items: readonly (Element | PlacedElement)[],
  now = NOW,
  scene = renderer,
): Frames {
  return scene.render(
    {
      elements: items.map((item) => ('element' in item ? item : placed(item))),
      application: 'app',
    },
    now,
  );
}

function rgb(canvas: Canvas, x: number, y: number): number[] {
  const { r, g, b } = canvas.pixel(x, y);
  return [r, g, b];
}

function grey(canvas: Canvas, x: number, y: number): number {
  return canvas.pixel(x, y).r;
}

/** The columns of row `y` that are not black. */
function lit(canvas: Canvas, y: number): number[] {
  return Array.from({ length: canvas.width }, (_, x) => x).filter((x) =>
    rgb(canvas, x, y).some((channel) => channel > 0),
  );
}

function blank(canvas: Canvas): boolean {
  return canvas.pixels.every((value) => value === 0);
}

function rectangle(fields: Record<string, unknown>): Element {
  return one({
    id: 'rect',
    type: 'rectangle',
    width: 4,
    height: 1,
    fill: 'solid',
    fill_colors: ['#FFFFFFFF'],
    border_width: 0,
    ...fields,
  });
}

function image(fields: Partial<ImageElement>): ImageElement {
  return {
    id: 'image',
    type: 'image',
    display: 'front',
    x: 0,
    y: 0,
    align: 'top_left',
    zIndex: undefined,
    timeout: undefined,
    displayUntil: undefined,
    source: { kind: 'path', path: 'never-uploaded.png' },
    opacity: 255,
    ...fields,
  };
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const BLACK = [0, 0, 0];
const YELLOW = [255, 255, 0];
const WHITE = [255, 255, 255];

describe('anchor', () => {
  it.each<[Align, number, number]>([
    ['top_left', 10, 8],
    ['top_mid', 8, 8],
    ['top_right', 5, 8],
    ['mid_left', 10, 7],
    ['center', 8, 7],
    ['mid_right', 5, 7],
    ['bottom_left', 10, 5],
    ['bottom_mid', 8, 5],
    ['bottom_right', 5, 5],
  ])('places a %s box from the point it names', (align, x, y) => {
    expect(anchor({ x: 10, y: 8, align }, 5, 3)).toStrictEqual({
      x,
      y,
      width: 5,
      height: 3,
    });
  });
});

describe('countdownText', () => {
  function countdown(fields: Record<string, unknown>): CountdownElement {
    const element = one({
      id: 'countdown',
      type: 'countdown',
      direction: 'time_left',
      show_hours: 'when_non_zero',
      timestamp: '0',
      ...fields,
    });
    if (element.type !== 'countdown') {
      throw new Error('Not a countdown.');
    }
    return element;
  }

  it.each([
    ['the time left', { timestamp: '1000075' }, '01:15'],
    [
      'the time since, with hours',
      { timestamp: '996275', direction: 'time_since' },
      '01:02:05',
    ],
    [
      'hours when asked to',
      { timestamp: '1000075', show_hours: 'always' },
      '00:01:15',
    ],
    ['zero once the time has passed', { timestamp: '999000' }, '00:00'],
    [
      'zero before the time since starts',
      { timestamp: '1000100', direction: 'time_since' },
      '00:00',
    ],
    [
      'hours wrapped at 60',
      { timestamp: String(1_000_000 + 61 * 3600 + 5) },
      '01:00:05',
    ],
    [
      'no hours when they wrap to zero',
      { timestamp: String(1_000_000 + 60 * 3600 + 59) },
      '00:59',
    ],
  ])('shows %s', (_name, fields, text) => {
    expect(countdownText(countdown(fields), NOW)).toBe(text);
  });

  it('counts whole seconds of the clock', () => {
    expect(countdownText(countdown({ timestamp: '1000075' }), NOW + 999)).toBe(
      '01:15',
    );
  });
});

describe('coverageAt', () => {
  const box = { x: 0, y: 0, width: 8, height: 8 };

  it('covers nothing outside the box', () => {
    expect(coverageAt(box, 4, -1, 4)).toBe(0);
    expect(coverageAt(box, 4, 4, -1)).toBe(0);
    expect(coverageAt(box, 4, 8, 4)).toBe(0);
    expect(coverageAt(box, 4, 4, 8)).toBe(0);
  });

  it('covers whole pixels of a square box and between corners', () => {
    expect(coverageAt(box, 0, 0, 0)).toBe(255);
    expect(coverageAt({ ...box, width: 16 }, 4, 8, 0)).toBe(255);
  });

  it('samples rounded corners on a 4x4 grid', () => {
    expect(coverageAt(box, 4, 0, 0)).toBe(0);
    // 11 of the 16 samples fall inside the arc.
    expect(coverageAt(box, 4, 0, 2)).toBe(175);
    expect(coverageAt(box, 4, 3, 3)).toBe(255);
  });
});

describe('SceneRenderer', () => {
  it('shows only the status bar while the canvas is closed', () => {
    const { front, back } = renderer.render(
      { elements: [placed(rectangle({}))], application: undefined },
      NOW,
    );

    expect([front.width, front.height, front.mode]).toStrictEqual([
      72,
      16,
      'rgb',
    ]);
    expect([back.width, back.height, back.mode]).toStrictEqual([160, 80, 'l8']);
    expect(blank(front)).toBe(true);
    const shown = Array.from({ length: 80 }, (_, y) => lit(back, y))
      .flat()
      .sort((a, b) => a - b);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]).toBeGreaterThanOrEqual(148);
    // A full battery: its outline, its cap, and its charge.
    expect(grey(back, 151, 67)).toBe(255);
    expect(grey(back, 153, 66)).toBe(255);
    expect(grey(back, 152, 68)).toBe(0);
    expect(grey(back, 153, 72)).toBe(255);
  });

  it('draws front elements bottom to top over black', () => {
    const { front } = draw([
      rectangle({ id: 'red', fill_colors: ['#FF0000FF'] }),
      rectangle({ id: 'blue', x: 2, fill_colors: ['#0000FFFF'] }),
    ]);

    expect(lit(front, 0)).toStrictEqual([0, 1, 2, 3, 4, 5]);
    expect(rgb(front, 1, 0)).toStrictEqual(RED);
    expect(rgb(front, 2, 0)).toStrictEqual(BLUE);
    expect(rgb(front, 5, 0)).toStrictEqual(BLUE);
    expect(lit(front, 1)).toStrictEqual([]);
  });

  it('mirrors the front on an "ACTIVE" card while nothing is on the back', () => {
    const { back } = draw([
      rectangle({ x: 10, y: 5, width: 1, fill_colors: ['#FF0000FF'] }),
    ]);

    // A white card with rounded corners, inside the app area.
    expect(grey(back, 73, 5)).toBe(255);
    expect(grey(back, 146, 20)).toBe(255);
    expect(grey(back, 73, 76)).toBe(255);
    expect(grey(back, 1, 3)).toBe(0);
    expect(grey(back, 0, 40)).toBe(0);
    expect(grey(back, 147, 20)).toBe(0);
    expect(grey(back, 73, 77)).toBe(0);
    // Its header: two black indicators around the label.
    expect(grey(back, 40, 10)).toBe(0);
    expect(grey(back, 58, 10)).toBe(255);
    expect(grey(back, 62, 6)).toBe(0);
    expect(grey(back, 65, 6)).toBe(255);
    expect(grey(back, 100, 10)).toBe(0);
    expect(grey(back, 73, 20)).toBe(255);
    // A black frame from row 24 to 57 holding the front at twice its size.
    expect(grey(back, 73, 24)).toBe(0);
    expect(grey(back, 73, 57)).toBe(0);
    expect(grey(back, 73, 58)).toBe(255);
    for (const [x, y] of [
      [22, 35],
      [23, 35],
      [22, 36],
      [23, 36],
    ] as const) {
      expect(grey(back, x, y)).toBe(76);
    }
    expect(grey(back, 24, 35)).toBe(0);
    expect(grey(back, 22, 37)).toBe(0);
  });

  it('centres the label alone when the indicator images are missing', () => {
    const bare: SceneAssets = {
      font: (name) => library.font(name),
      image: () => undefined,
      errorIcon: library.errorIcon,
    };

    const { back } = draw([], NOW, new SceneRenderer(bare));

    expect(grey(back, 40, 10)).toBe(255);
    expect(grey(back, 100, 10)).toBe(255);
    expect([57, 58, 60, 61, 80, 81].map((x) => grey(back, x, 6))).toStrictEqual(
      [255, 0, 0, 255, 0, 255],
    );
  });

  it('draws back elements instead of the card, left of the status bar', () => {
    const { front, back } = draw([
      rectangle({
        display: 'back',
        x: 140,
        width: 20,
        height: 2,
        fill_colors: ['#00FF00FF'],
      }),
    ]);

    expect(blank(front)).toBe(true);
    expect(lit(back, 0)).toStrictEqual([
      140, 141, 142, 143, 144, 145, 146, 147,
    ]);
    expect(grey(back, 140, 1)).toBe(150);
    expect(grey(back, 73, 5)).toBe(0);
    expect(grey(back, 151, 67)).toBe(255);
  });

  it('turns colours into LVGL luminance on the back', () => {
    const { back } = draw([
      rectangle({ display: 'back', fill_colors: ['#FF0000FF'] }),
      rectangle({ display: 'back', id: 'g', y: 1, fill_colors: ['#00FF00FF'] }),
      rectangle({ display: 'back', id: 'b', y: 2, fill_colors: ['#0000FFFF'] }),
    ]);

    expect([
      grey(back, 0, 0),
      grey(back, 0, 1),
      grey(back, 0, 2),
    ]).toStrictEqual([76, 150, 27]);
  });

  describe('text', () => {
    function text(fields: Record<string, unknown>): Element {
      return one({ id: 'text', type: 'text', font: 'small', ...fields });
    }

    it('draws each glyph from the top-left corner of the box', () => {
      const { front } = draw([text({ text: 'AB' })]);

      expect(lit(front, 0)).toStrictEqual([0, 1, 2, 4, 5, 6]);
      expect(lit(front, 4)).toStrictEqual([0, 1, 2, 4, 5, 6]);
      expect(lit(front, 5)).toStrictEqual([]);
      expect(rgb(front, 0, 0)).toStrictEqual(WHITE);
    });

    it('aligns the box the text measures', () => {
      const { front } = draw([
        text({ text: 'AB', x: 36, y: 8, align: 'center' }),
      ]);

      expect(lit(front, 4)).toStrictEqual([]);
      expect(lit(front, 5)).toStrictEqual([32, 33, 34, 36, 37, 38]);
      expect(lit(front, 9)).toStrictEqual([32, 33, 34, 36, 37, 38]);
      expect(lit(front, 10)).toStrictEqual([]);
    });

    it('clips the text to its width', () => {
      const { front } = draw([text({ text: 'AB', width: 5 })]);

      expect(lit(front, 0)).toStrictEqual([0, 1, 2, 4]);
    });

    it('draws nothing in a colour at or below the minimum opacity', () => {
      expect(
        blank(draw([text({ text: 'AB', color: '#FFFFFF02' })]).front),
      ).toBe(true);
      expect(
        lit(draw([text({ text: 'AB', color: '#FFFFFF03' })]).front, 0),
      ).toHaveLength(6);
    });

    it('scrolls text wider than its box, a copy following three spaces behind', () => {
      // 40 pixels of text and 12 of spaces at 100 pixels a second: one
      // round takes 520 ms.
      const scrolling = placed(
        text({ text: 'ABCDEFGHIJ', width: 20, scroll_rate: 6000 }),
        { since: NOW - 1000 },
      );

      expect(lit(draw([scrolling], NOW - 1000).front, 0)).toStrictEqual([
        0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18,
      ]);
      // Halfway: moved 26 pixels, showing the end of the text.
      expect(lit(draw([scrolling], NOW - 740).front, 0)).toStrictEqual([
        0, 2, 3, 4, 6, 7, 8, 10, 11, 12,
      ]);
      // Moved 46 pixels: the copy shows the start again.
      expect(lit(draw([scrolling], NOW - 545).front, 0)).toStrictEqual([
        6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19,
      ]);
    });

    it('waits out the start delay before scrolling', () => {
      const waiting = placed(
        text({
          text: 'ABCDEFGHIJ',
          width: 20,
          scroll_rate: 6000,
          scroll_start_delay: 1000,
        }),
        { since: NOW - 500 },
      );

      expect(lit(draw([waiting]).front, 0)).toStrictEqual([
        0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18,
      ]);
    });

    it('keeps text that fits its box still', () => {
      const still = placed(text({ text: 'AB', scroll_rate: 6000 }), {
        since: NOW - 260,
      });

      expect(lit(draw([still]).front, 0)).toStrictEqual([0, 1, 2, 4, 5, 6]);
    });
  });

  describe('countdown', () => {
    const fields = {
      id: 'countdown',
      type: 'countdown',
      timestamp: '1000075',
      direction: 'time_left',
      show_hours: 'when_non_zero',
    };

    it('draws its text in the superscript font', () => {
      const fonts: FontName[] = [];
      const recording: SceneAssets = {
        font: (name) => {
          fonts.push(name);
          return library.font(name);
        },
        image: (source, application) => library.image(source, application),
        errorIcon: library.errorIcon,
      };

      const { back } = draw(
        [one({ ...fields, display: 'back' })],
        NOW,
        new SceneRenderer(recording),
      );

      expect(fonts).toStrictEqual(['superscript']);
      // "01:15": five glyphs.
      expect(lit(back, 0)).toStrictEqual([
        0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18,
      ]);
    });

    it('aligns the box its text measures', () => {
      const { front } = draw([one({ ...fields, x: 72, align: 'top_right' })]);

      expect(lit(front, 0)[0]).toBe(52);
      expect(lit(front, 0).at(-1)).toBe(70);
    });

    it('draws nothing in a near-transparent colour', () => {
      expect(blank(draw([one({ ...fields, color: '#FFFFFF00' })]).front)).toBe(
        true,
      );
    });
  });

  describe('image', () => {
    it('draws a stock image at its anchor', () => {
      const { front } = draw([
        one({
          id: 'dot',
          type: 'image',
          stock_path: 'shared/dot_2x2.image',
          x: 36,
          y: 8,
          align: 'center',
        }),
      ]);

      expect(lit(front, 7)).toStrictEqual([35, 36]);
      expect(lit(front, 8)).toStrictEqual([35, 36]);
      expect(rgb(front, 35, 7)).toStrictEqual(RED);
      expect(lit(front, 6)).toStrictEqual([]);
    });

    it('draws the 9x9 error icon for an image it cannot load', () => {
      const { front } = draw([image({})]);

      expect(lit(front, 0)).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(lit(front, 8)).toHaveLength(9);
      expect(lit(front, 9)).toStrictEqual([]);
      expect(rgb(front, 4, 4)).toStrictEqual(YELLOW);
      expect(blank(draw([image({ opacity: 2 })]).front)).toBe(true);
    });

    it('applies its opacity, drawing nothing at the minimum', () => {
      const dot = {
        id: 'dot',
        type: 'image',
        stock_path: 'shared/dot_2x2.image',
      };

      // 50 % is 127 of 255: red over black is 125, as on the bar.
      expect(
        rgb(draw([one({ ...dot, opacity: 50 })]).front, 0, 0),
      ).toStrictEqual([125, 0, 0]);
      expect(blank(draw([one({ ...dot, opacity: 1 })]).front)).toBe(true);
    });
  });

  describe('animation', () => {
    const blink = {
      id: 'blink',
      type: 'animation',
      stock_path: 'shared/blink_4x2.anim',
      loop: true,
    };

    async function onDevice(fields: Record<string, unknown>) {
      let now = NOW;
      const device = new Device(library, () => now);
      await device.draw({ application_name: 'app', elements: [fields] });
      return {
        frames: (): Frames =>
          renderer.render(
            {
              elements: device.screen.elements(),
              application: device.screen.owner?.app,
            },
            now,
          ),
        advance: (ms: number): void => {
          now += ms;
          device.screen.tick();
        },
      };
    }

    it("shows the player's current frame", async () => {
      const playing = await onDevice(blink);

      expect(lit(playing.frames().front, 0)).toStrictEqual([0, 1, 2, 3]);
      expect(rgb(playing.frames().front, 3, 1)).toStrictEqual(RED);
      expect(lit(playing.frames().front, 2)).toStrictEqual([]);

      // 10 fps on an 8 ms GUI tick: the next frame comes after 104 ms.
      playing.advance(104);

      expect(rgb(playing.frames().front, 0, 0)).toStrictEqual([0, 255, 0]);
    });

    it('anchors by the size of the animation', async () => {
      const playing = await onDevice({
        ...blink,
        x: 36,
        y: 8,
        align: 'center',
      });

      expect(lit(playing.frames().front, 7)).toStrictEqual([34, 35, 36, 37]);
      expect(lit(playing.frames().front, 8)).toStrictEqual([34, 35, 36, 37]);
      expect(lit(playing.frames().front, 9)).toStrictEqual([]);
    });

    it('shows the error icon for a file that did not load', async () => {
      const broken = await onDevice({
        ...blink,
        stock_path: 'shared/missing.anim',
      });

      expect(lit(broken.frames().front, 8)).toHaveLength(9);
      expect(rgb(broken.frames().front, 0, 0)).toStrictEqual(YELLOW);
    });

    it('shows the error icon without a player', () => {
      expect(rgb(draw([one(blink)]).front, 8, 8)).toStrictEqual(YELLOW);
    });

    it('draws nothing at the minimum opacity or before a first frame', async () => {
      const faint = await onDevice({ ...blink, opacity: 1 });
      const empty: Animation = {
        width: 4,
        height: 2,
        fps: 10,
        frames: [],
        sections: new Map(),
      };
      const player = new AnimationPlayer(
        'empty',
        empty,
        { section: 'default', loop: true, awaitPreviousEnd: false },
        NOW,
      );

      expect(blank(faint.frames().front)).toBe(true);
      expect(blank(draw([placed(one(blink), { player })]).front)).toBe(true);
    });
  });

  describe('rectangle', () => {
    it.each(['solid', 'gradient_h', 'gradient_v', 'none'])(
      'bounds %s fill and border work to the visible display',
      (fill) => {
        const blend = vi.spyOn(Canvas.prototype, 'blend');
        const { front } = draw([
          rectangle({
            x: -10,
            y: -10,
            width: 100,
            height: 100,
            fill,
            fill_colors: fill.startsWith('gradient')
              ? ['#FF0000FF', '#0000FFFF']
              : ['#FFFFFFFF'],
            border_width: 20,
            radius: 12,
          }),
        ]);

        const calls = blend.mock.contexts.filter((canvas) => canvas === front);
        expect(calls.length).toBeLessThanOrEqual(
          front.width * front.height * 2,
        );
        expect(blank(front)).toBe(false);
      },
    );

    it.each(['solid', 'gradient_h', 'gradient_v', 'none'])(
      'skips wholly off-screen %s rectangles',
      (fill) => {
        const blend = vi.spyOn(Canvas.prototype, 'blend');
        const { front } = draw([
          rectangle({
            x: 100,
            y: 100,
            width: 100,
            height: 100,
            fill,
            fill_colors: fill.startsWith('gradient')
              ? ['#FF0000FF', '#0000FFFF']
              : ['#FFFFFFFF'],
            border_width: 2,
            radius: 12,
          }),
        ]);

        expect(
          blend.mock.contexts.filter((canvas) => canvas === front),
        ).toHaveLength(0);
        expect(blank(front)).toBe(true);
      },
    );

    it.each(['solid', 'gradient_h', 'gradient_v', 'none'])(
      'preserves %s colors and rounded edges when clipping',
      (fill) => {
        const fields = {
          width: 8,
          height: 8,
          fill,
          fill_colors: fill.startsWith('gradient')
            ? ['#FF0000FF', '#0000FFFF']
            : ['#FFFFFFFF'],
          border_width: 1,
          radius: 4,
        };
        const full = draw([rectangle(fields)]).front;
        const clipped = draw([rectangle({ ...fields, x: -3, y: -2 })]).front;

        for (let y = 0; y < 6; y += 1) {
          for (let x = 0; x < 5; x += 1) {
            expect(rgb(clipped, x, y)).toStrictEqual(rgb(full, x + 3, y + 2));
          }
        }
      },
    );

    it('fills solid with the colour, its alpha as opacity', () => {
      expect(rgb(draw([rectangle({})]).front, 3, 0)).toStrictEqual(WHITE);
      expect(
        rgb(draw([rectangle({ fill_colors: ['#FF000080'] })]).front, 0, 0),
      ).toStrictEqual([126, 0, 0]);
      expect(
        blank(draw([rectangle({ fill_colors: ['#FF000002'] })]).front),
      ).toBe(true);
    });

    it('draws a one-pixel white border inside the box by default', () => {
      const { front } = draw([
        one({ id: 'r', type: 'rectangle', width: 6, height: 4 }),
      ]);

      expect(lit(front, 0)).toStrictEqual([0, 1, 2, 3, 4, 5]);
      expect(lit(front, 1)).toStrictEqual([0, 5]);
      expect(lit(front, 2)).toStrictEqual([0, 5]);
      expect(lit(front, 3)).toStrictEqual([0, 1, 2, 3, 4, 5]);
      expect(rgb(front, 0, 0)).toStrictEqual(WHITE);
    });

    it('leaves the inside of a wide border open, and fills a thick one', () => {
      const wide = draw([
        rectangle({ fill: 'none', width: 6, height: 6, border_width: 2 }),
      ]).front;
      const thick = draw([
        rectangle({ fill: 'none', width: 4, height: 4, border_width: 3 }),
      ]).front;

      expect(lit(wide, 1)).toStrictEqual([0, 1, 2, 3, 4, 5]);
      expect(lit(wide, 2)).toStrictEqual([0, 1, 4, 5]);
      expect(lit(wide, 3)).toStrictEqual([0, 1, 4, 5]);
      expect(lit(thick, 1)).toStrictEqual([0, 1, 2, 3]);
      expect(lit(thick, 2)).toStrictEqual([0, 1, 2, 3]);
    });

    it('draws no border in a near-transparent colour or a wrapped width', () => {
      const border = { fill: 'none', width: 6, height: 4, border_width: 1 };

      expect(
        blank(
          draw([rectangle({ ...border, border_color: '#FFFFFF02' })]).front,
        ),
      ).toBe(true);
      // The firmware passes the width on as an int8: 255 is -1.
      expect(
        blank(draw([rectangle({ ...border, border_width: 255 })]).front),
      ).toBe(true);
    });

    it('blends a horizontal gradient the way LVGL does', () => {
      const { front } = draw([
        rectangle({
          width: 10,
          fill: 'gradient_h',
          fill_colors: ['#FF0000FF', '#0000FFFF'],
        }),
      ]);

      expect(rgb(front, 0, 0)).toStrictEqual(RED);
      expect(rgb(front, 1, 0)).toStrictEqual([227, 0, 28]);
      expect(rgb(front, 8, 0)).toStrictEqual([29, 0, 226]);
      expect(rgb(front, 9, 0)).toStrictEqual(BLUE);
    });

    it('blends a vertical gradient down the height', () => {
      const { front } = draw([
        rectangle({
          width: 1,
          height: 4,
          fill: 'gradient_v',
          fill_colors: ['#00FF00FF', '#0000FFFF'],
        }),
      ]);

      expect([0, 1, 2, 3].map((y) => rgb(front, 0, y))).toStrictEqual([
        [0, 255, 0],
        [0, 170, 85],
        [0, 85, 170],
        [0, 0, 255],
      ]);
    });

    it('blends the opacity of the two gradient colours too', () => {
      const { front } = draw([
        rectangle({
          width: 10,
          fill: 'gradient_h',
          fill_colors: ['#FF0000FF', '#FF000000'],
        }),
      ]);

      expect(rgb(front, 0, 0)).toStrictEqual(RED);
      expect(rgb(front, 1, 0)).toStrictEqual([225, 0, 0]);
      expect(rgb(front, 9, 0)).toStrictEqual(BLACK);
    });

    it('anti-aliases rounded corners', () => {
      const { front } = draw([rectangle({ width: 8, height: 8, radius: 4 })]);

      expect(rgb(front, 0, 0)).toStrictEqual(BLACK);
      // A 175 of 255 coverage blends white over black to 174.
      expect(rgb(front, 0, 2)).toStrictEqual([174, 174, 174]);
      expect(rgb(front, 4, 4)).toStrictEqual(WHITE);
    });

    it('rounds a gradient and a border along the same corners', () => {
      const gradient = draw([
        rectangle({
          width: 8,
          height: 8,
          radius: 4,
          fill: 'gradient_v',
          fill_colors: ['#FFFFFFFF', '#FFFFFFFF'],
        }),
      ]).front;
      const border = draw([
        rectangle({
          width: 8,
          height: 8,
          radius: 4,
          fill: 'none',
          border_width: 1,
        }),
      ]).front;

      expect(rgb(gradient, 0, 0)).toStrictEqual(BLACK);
      expect(rgb(gradient, 0, 2)).toStrictEqual([174, 174, 174]);
      expect(rgb(border, 0, 0)).toStrictEqual(BLACK);
      expect(rgb(border, 4, 0)).toStrictEqual(WHITE);
      expect(rgb(border, 4, 4)).toStrictEqual(BLACK);
    });

    it('limits the radius to half the shorter side', () => {
      // A radius of 2 on the 8x4 box: 6 of 16 samples, 96 of 255.
      expect(
        rgb(draw([rectangle({ width: 8, height: 4, radius: 10 })]).front, 0, 0),
      ).toStrictEqual([95, 95, 95]);
    });

    it('treats a radius past 127 as the negative int8 the firmware passes', () => {
      expect(
        rgb(
          draw([rectangle({ width: 8, height: 8, radius: 200 })]).front,
          0,
          0,
        ),
      ).toStrictEqual(WHITE);
    });
  });

  describe('xpmbitmap', () => {
    const data = '! XPM2\n2 1 2 1\na c #FF0000\nb c #0000FF\nab';

    it('draws its decoded bitmap', () => {
      const { front } = draw([one({ id: 'x', type: 'xpmbitmap', data })]);

      expect(rgb(front, 0, 0)).toStrictEqual(RED);
      expect(rgb(front, 1, 0)).toStrictEqual(BLUE);
      expect(lit(front, 0)).toStrictEqual([0, 1]);
    });

    it('draws nothing at zero opacity', () => {
      expect(
        blank(
          draw([one({ id: 'x', type: 'xpmbitmap', data, opacity: 0 })]).front,
        ),
      ).toBe(true);
    });
  });
});
