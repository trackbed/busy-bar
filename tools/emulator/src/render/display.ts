// The bar's two displays: the front's 72×16 RGB panel and the back's 160×80
// grey one, whose status bar takes its rightmost columns from apps.

export const DISPLAYS = ['front', 'back'] as const;
export type DisplayName = (typeof DISPLAYS)[number];

/** Each display's size, which the firmware also checks images against. */
export const DISPLAY_SIZES: Readonly<
  Record<DisplayName, { readonly width: number; readonly height: number }>
> = {
  front: { width: 72, height: 16 },
  back: { width: 160, height: 80 },
};

/** The back display's status bar width, in its rightmost columns. */
export const STATUS_BAR_WIDTH = 12;
