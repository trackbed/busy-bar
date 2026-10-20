/** Pixel size of a BUSY Bar display. */
export interface DisplaySize {
  readonly width: number;
  readonly height: number;
}

/**
 * The 72×16 RGB LED matrix on the front. Elements placed outside it are not
 * visible.
 */
export const FRONT_DISPLAY: DisplaySize = { width: 72, height: 16 };

/**
 * The part of the 160×80 back screen apps can draw on. The firmware's
 * status bar keeps the rightmost 12 columns, so elements past x = 147 are
 * cut off. The screen shows 16 levels of grey.
 */
export const BACK_DISPLAY: DisplaySize = { width: 148, height: 80 };

/**
 * Format a colour as the `#RRGGBBAA` string the display API expects.
 * Channels are integers from 0 to 255; alpha defaults to fully opaque.
 */
export function rgba(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): string {
  return `#${[red, green, blue, alpha].map(toHexByte).join('')}`;
}

function toHexByte(channel: number): string {
  if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
    throw new RangeError(
      `Colour channels must be integers from 0 to 255; got ${channel}.`,
    );
  }
  return channel.toString(16).padStart(2, '0').toUpperCase();
}
