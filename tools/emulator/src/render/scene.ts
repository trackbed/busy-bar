// Both displays drawn from what is on the app canvas, the way the firmware's
// canvas service lays elements out (applications/services/canvas in the
// firmware) and LVGL draws them.

import type {
  Align,
  AssetSource,
  CountdownElement,
  Element,
  FontName,
  RectangleElement,
  TextElement,
} from '../device/elements.ts';
import type { PlacedElement } from '../device/screen.ts';
import type { Font } from '../formats/font.ts';
import type { Bitmap } from '../formats/png.ts';
import type { Box, Rgba } from './canvas.ts';
import { BLACK, Canvas, intersect, OPA_MIN, WHITE } from './canvas.ts';
import type { DisplayName } from './display.ts';
import { DISPLAY_SIZES, STATUS_BAR_WIDTH } from './display.ts';
import type { TextLayout } from './text.ts';
import { drawText, layoutText, scrollOffset } from './text.ts';

const FRONT_SIZE = DISPLAY_SIZES.front;
const BACK_SIZE = DISPLAY_SIZES.back;
const BACK_APP_WIDTH = BACK_SIZE.width - STATUS_BAR_WIDTH;

/** What drawing needs from the asset store. */
export interface SceneAssets {
  font(name: FontName): Font;
  image(source: AssetSource, application: string): Bitmap | undefined;
  readonly errorIcon: Bitmap;
}

/** What is on the canvas, and whose it is. */
export interface Scene {
  /** Bottom to top. */
  readonly elements: readonly PlacedElement[];
  /** The app drawing, or undefined while the canvas is closed. */
  readonly application: string | undefined;
}

export interface Frames {
  /** RGB. */
  readonly front: Canvas;
  /** 8-bit grey. */
  readonly back: Canvas;
}

/** Draws scenes; keeps text layouts between frames. */
export class SceneRenderer {
  readonly #assets: SceneAssets;
  readonly #layouts = new WeakMap<TextElement, TextLayout>();

  constructor(assets: SceneAssets) {
    this.#assets = assets;
  }

  render(scene: Scene, now: number): Frames {
    const front = new Canvas(FRONT_SIZE.width, FRONT_SIZE.height, 'rgb');
    const back = new Canvas(BACK_SIZE.width, BACK_SIZE.height, 'l8');
    const { application } = scene;
    if (application !== undefined) {
      const placed = (display: DisplayName): PlacedElement[] =>
        scene.elements.filter((item) => item.element.display === display);
      front.fill(BLACK);
      for (const item of placed('front')) {
        this.#draw(front, item, application, now);
      }
      const backElements = placed('back');
      back.clipped(
        { x: 0, y: 0, width: BACK_APP_WIDTH, height: BACK_SIZE.height },
        () => {
          if (backElements.length === 0) {
            this.#drawMirrorCard(back, front);
            return;
          }
          for (const item of backElements) {
            this.#draw(back, item, application, now);
          }
        },
      );
    }
    drawStatusBar(back);
    return { front, back };
  }

  #draw(
    canvas: Canvas,
    placed: PlacedElement,
    application: string,
    now: number,
  ): void {
    const { element } = placed;
    switch (element.type) {
      case 'text':
        this.#drawText(canvas, element, now - placed.since);
        break;
      case 'countdown':
        this.#drawCountdown(canvas, element, now);
        break;
      case 'image': {
        const image =
          this.#assets.image(element.source, application) ??
          this.#assets.errorIcon;
        drawBitmapElement(canvas, element, image, element.opacity);
        break;
      }
      case 'animation': {
        const animation = placed.player?.animation;
        if (animation === undefined) {
          drawBitmapElement(
            canvas,
            element,
            this.#assets.errorIcon,
            element.opacity,
          );
          break;
        }
        const box = anchor(element, animation.width, animation.height);
        const frame = placed.player?.frame;
        if (frame !== undefined && element.opacity > OPA_MIN) {
          canvas.drawBitmap(frame, box.x, box.y, element.opacity);
        }
        break;
      }
      case 'rectangle':
        drawRectangle(canvas, element);
        break;
      case 'xpmbitmap':
        drawBitmapElement(canvas, element, element.bitmap, element.opacity);
        break;
    }
  }

  #drawText(canvas: Canvas, element: TextElement, elapsedMs: number): void {
    let layout = this.#layouts.get(element);
    if (layout === undefined) {
      layout = layoutText(this.#assets.font(element.font), element.text);
      this.#layouts.set(element, layout);
    }
    const width = element.width ?? layout.width;
    const box = anchor(element, width, layout.height);
    if (element.color.a <= OPA_MIN) {
      return;
    }
    canvas.clipped(box, () => {
      if (element.scrollRate === 0 || layout.width <= width) {
        drawText(canvas, layout, box.x, box.y, element.color);
        return;
      }
      const space = layout.font.advance(0x20, 0x20);
      const { offset, distance } = scrollOffset(
        layout.width,
        space,
        {
          rate: element.scrollRate,
          startDelayMs: element.scrollStartDelay,
          repeatDelayMs: element.scrollRepeatDelay,
        },
        elapsedMs,
      );
      drawText(canvas, layout, box.x + offset, box.y, element.color);
      drawText(canvas, layout, box.x + offset + distance, box.y, element.color);
    });
  }

  #drawCountdown(canvas: Canvas, element: CountdownElement, now: number): void {
    const layout = layoutText(
      this.#assets.font('superscript'),
      countdownText(element, now),
    );
    const box = anchor(element, layout.width, layout.height);
    if (element.color.a > OPA_MIN) {
      canvas.clipped(box, () => {
        drawText(canvas, layout, box.x, box.y, element.color);
      });
    }
  }

  /**
   * The card the back display shows while an app draws only on the front:
   * an "ACTIVE" header over the front display at twice its size. The
   * firmware builds it from LVGL flex layouts (gui/modules/mirror_card.c);
   * this places the same parts at their resolved positions.
   */
  #drawMirrorCard(back: Canvas, front: Canvas): void {
    const card: Box = { x: 1, y: 3, width: 146, height: 74 };
    fillRounded(back, card, 4, WHITE, 255);
    const left = this.#assets.image(
      { kind: 'stock', path: 'shared/active_indicator_left_28x7.image' },
      '',
    );
    const right = this.#assets.image(
      { kind: 'stock', path: 'shared/active_indicator_right_28x7.image' },
      '',
    );
    const label = layoutText(this.#assets.font('small'), 'ACTIVE');
    const gap = 4;
    const labelWidth = label.width + 1;
    const headerWidth =
      (left?.width ?? 0) + gap + labelWidth + gap + (right?.width ?? 0);
    let x = card.x + Math.floor((card.width - headerWidth) / 2);
    const rowTop = card.y + 3;
    if (left !== undefined) {
      back.drawBitmap(left, x, rowTop + 1);
      x += left.width + gap;
    }
    drawText(back, label, x + 1, rowTop, BLACK);
    x += labelWidth + gap;
    if (right !== undefined) {
      back.drawBitmap(right, x, rowTop + 1);
    }
    // The front at twice its size, in a black frame whose rounded corners
    // clip it.
    const frame: Box = { x: card.x, y: card.y + 21, width: 146, height: 34 };
    fillRounded(back, frame, 3, BLACK, 255);
    for (let y = 0; y < FRONT_SIZE.height * 2; y += 1) {
      for (let x = 0; x < FRONT_SIZE.width * 2; x += 1) {
        const coverage = coverageAt(frame, 3, frame.x + 1 + x, frame.y + 1 + y);
        back.blend(frame.x + 1 + x, frame.y + 1 + y, {
          ...front.pixel(x >> 1, y >> 1),
          a: coverage,
        });
      }
    }
  }
}

/**
 * Where an element of this size lands: `x` and `y` name the point its
 * alignment refers to, measured from the display's top-left corner
 * (canvas_widget_reanchor in the firmware).
 */
export function anchor(
  element: { readonly x: number; readonly y: number; readonly align: Align },
  width: number,
  height: number,
): Box {
  const [vertical, horizontal] =
    element.align === 'center' ? ['mid', 'mid'] : element.align.split('_');
  const x =
    horizontal === 'left'
      ? element.x
      : horizontal === 'mid'
        ? element.x - Math.floor(width / 2)
        : element.x - width;
  const y =
    vertical === 'top'
      ? element.y
      : vertical === 'mid'
        ? element.y - Math.floor(height / 2)
        : element.y - height;
  return { x, y, width, height };
}

/**
 * A countdown's text: MM:SS, or HH:MM:SS when there are hours or the
 * element asks for them. Like the firmware, hours wrap at 60 and the count
 * stops at zero.
 */
export function countdownText(element: CountdownElement, now: number): string {
  let delta = element.timestamp - Math.floor(now / 1000);
  if (element.direction === 'time_since') {
    delta = -delta;
  }
  delta = Math.max(0, delta);
  const two = (value: number): string => String(value).padStart(2, '0');
  const seconds = delta % 60;
  const minutes = Math.floor(delta / 60) % 60;
  const hours = Math.floor(delta / 3600) % 60;
  return hours > 0 || element.showHours === 'always'
    ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

function drawBitmapElement(
  canvas: Canvas,
  element: Element,
  bitmap: Bitmap,
  opacity: number,
): void {
  const box = anchor(element, bitmap.width, bitmap.height);
  if (opacity > OPA_MIN) {
    canvas.drawBitmap(bitmap, box.x, box.y, opacity);
  }
}

/**
 * A rectangle as an LVGL object draws it: the fill (solid or a two-stop
 * gradient) clipped to the rounded shape, then the border inside the edge.
 * The firmware passes radius and border width on as 8-bit signed values.
 */
function drawRectangle(canvas: Canvas, element: RectangleElement): void {
  const box = anchor(element, element.width, element.height);
  const radius = Math.min(
    Math.max(0, toInt8(element.radius)),
    Math.min(box.width, box.height) >> 1,
  );
  const borderWidth = Math.max(0, toInt8(element.borderWidth));
  const [start, end] = element.fillColors;
  canvas.clipped(box, () => {
    const clip = canvas.clip;
    if (element.fill === 'solid') {
      if (start.a > OPA_MIN) {
        fillRounded(canvas, box, radius, start, start.a);
      }
    } else if (element.fill !== 'none') {
      const horizontal = element.fill === 'gradient_h';
      const size = horizontal ? box.width : box.height;
      for (let y = clip.y; y < clip.y + clip.height; y += 1) {
        for (let x = clip.x; x < clip.x + clip.width; x += 1) {
          const coverage = coverageAt(box, radius, x, y);
          if (coverage > 0) {
            const stop = gradientStop(
              start,
              end,
              size,
              horizontal ? x - box.x : y - box.y,
            );
            canvas.blend(x, y, { ...stop, a: coverage }, stop.a);
          }
        }
      }
    }
    if (borderWidth > 0 && element.borderColor.a > OPA_MIN) {
      const inner: Box = {
        x: box.x + borderWidth,
        y: box.y + borderWidth,
        width: box.width - 2 * borderWidth,
        height: box.height - 2 * borderWidth,
      };
      const innerRadius = Math.max(0, radius - borderWidth);
      for (let y = clip.y; y < clip.y + clip.height; y += 1) {
        for (let x = clip.x; x < clip.x + clip.width; x += 1) {
          const outside = coverageAt(box, radius, x, y);
          const hole =
            inner.width > 0 && inner.height > 0
              ? coverageAt(inner, innerRadius, x, y)
              : 0;
          const coverage = Math.max(0, outside - hole);
          if (coverage > 0) {
            canvas.blend(
              x,
              y,
              { ...element.borderColor, a: coverage },
              element.borderColor.a,
            );
          }
        }
      }
    }
  });
}

/** LVGL's colour and opacity at `position` along a two-stop gradient. */
function gradientStop(
  start: Rgba,
  end: Rgba,
  size: number,
  position: number,
): Rgba {
  const max = (255 * size) >> 8;
  if (position <= 0) {
    return start;
  }
  if (position >= max) {
    return end;
  }
  const mix = Math.floor((position * 255) / max);
  const blend = (a: number, b: number): number =>
    udiv255(b * mix + a * (255 - mix));
  return {
    r: blend(start.r, end.r),
    g: blend(start.g, end.g),
    b: blend(start.b, end.b),
    a: blend(start.a, end.a),
  };
}

/** LVGL's LV_UDIV255: division by 255 with a multiply and a shift. */
function udiv255(value: number): number {
  return Math.floor((value * 0x8081) / 2 ** 23);
}

function fillRounded(
  canvas: Canvas,
  box: Box,
  radius: number,
  color: Rgba,
  opacity: number,
): void {
  const clip = intersect(box, canvas.clip);
  for (let y = clip.y; y < clip.y + clip.height; y += 1) {
    for (let x = clip.x; x < clip.x + clip.width; x += 1) {
      const coverage = coverageAt(box, radius, x, y);
      if (coverage > 0) {
        canvas.blend(x, y, { ...color, a: coverage }, opacity);
      }
    }
  }
}

const SAMPLES = 4;

/**
 * How much of pixel (x, y) a rounded box covers, 0 to 255. Square boxes
 * cover whole pixels; rounded corners are sampled on a 4x4 grid, which
 * approximates LVGL's anti-aliased radius mask.
 */
export function coverageAt(
  box: Box,
  radius: number,
  x: number,
  y: number,
): number {
  if (
    x < box.x ||
    y < box.y ||
    x >= box.x + box.width ||
    y >= box.y + box.height
  ) {
    return 0;
  }
  if (radius <= 0) {
    return 255;
  }
  const cornerX =
    x < box.x + radius
      ? box.x + radius
      : x >= box.x + box.width - radius
        ? box.x + box.width - radius
        : undefined;
  const cornerY =
    y < box.y + radius
      ? box.y + radius
      : y >= box.y + box.height - radius
        ? box.y + box.height - radius
        : undefined;
  if (cornerX === undefined || cornerY === undefined) {
    return 255;
  }
  let inside = 0;
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const dx = x + (sx + 0.5) / SAMPLES - cornerX;
      const dy = y + (sy + 0.5) / SAMPLES - cornerY;
      if (dx * dx + dy * dy <= radius * radius) {
        inside += 1;
      }
    }
  }
  return Math.round((inside * 255) / (SAMPLES * SAMPLES));
}

function toInt8(value: number): number {
  return ((value & 0xff) ^ 0x80) - 0x80;
}

/** The back display's status bar, reduced to a full battery. */
function drawStatusBar(back: Canvas): void {
  const x = BACK_APP_WIDTH + 3;
  const y = BACK_SIZE.height - 14;
  back.fillBox({ x: x + 2, y, width: 2, height: 1 }, WHITE);
  for (const side of [
    { x, y: y + 1, width: 6, height: 1 },
    { x, y: y + 11, width: 6, height: 1 },
    { x, y: y + 1, width: 1, height: 11 },
    { x: x + 5, y: y + 1, width: 1, height: 11 },
  ]) {
    back.fillBox(side, WHITE);
  }
  back.fillBox({ x: x + 2, y: y + 3, width: 2, height: 7 }, WHITE);
}
