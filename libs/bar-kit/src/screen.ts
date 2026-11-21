// Whether an app's frames reach the screen. Every input listener gets every
// event, whichever app is on screen, so an app that acts on the buttons asks
// this first.

import type { BarDisplayClient } from './run-bar-app.ts';

/** How long after its last drawn frame the app still counts as on screen. */
export const ON_SCREEN_MS = 2500;

/** A display client that remembers whether the app's frames reach the bar. */
export interface TrackedScreen {
  readonly client: BarDisplayClient;
  /**
   * Whether a frame drew recently: the bar refused none for its BUSY timer
   * or an app of higher priority since.
   */
  readonly onScreen: () => boolean;
}

/**
 * Wrap `client`, for `runBarApp`, to follow what reaches the screen: a frame
 * that draws puts the app on screen for {@link ON_SCREEN_MS}, and a refused
 * one, while the BUSY timer or an app of higher priority holds the screen,
 * takes it off at once. The Python kit's `track_screen` behaves the same way.
 */
export function trackScreen(
  client: BarDisplayClient,
  now: () => number = Date.now,
): TrackedScreen {
  let drawnAt: number | undefined;
  return {
    client: {
      async DisplayDraw(params, options) {
        try {
          const result = await client.DisplayDraw(params, options);
          drawnAt = now();
          return result;
        } catch (error) {
          drawnAt = undefined;
          throw error;
        }
      },
      DisplayClear: (params, options) => client.DisplayClear(params, options),
    },
    onScreen: () => drawnAt !== undefined && now() - drawnAt <= ON_SCREEN_MS,
  };
}
