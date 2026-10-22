// Public API of @busy-bar-apps/bar-kit. Export each name explicitly so the
// package surface stays deliberate.

export type {
  AnimationElement,
  CountdownElement,
  ImageElement,
  RectangleElement,
  TextElement,
} from '@busy-app/busy-lib';
export { toBarText } from './bar-text.ts';
export { createBusyBar } from './client.ts';
export type { BarConfig } from './config.ts';
export {
  BarConfigError,
  CLOUD_ADDRESS,
  isCloudAddress,
  loadBarConfig,
  USB_ADDRESS,
} from './config.ts';
export type { DisplaySize } from './display.ts';
export { BACK_DISPLAY, FRONT_DISPLAY, rgba } from './display.ts';
export type { BarFont } from './fonts.ts';
export { ELLIPSIS, fitText, textWidth } from './fonts.ts';
export type { PollFailure, Poller, PollerOptions, Snapshot } from './poller.ts';
export { createPoller } from './poller.ts';
export type { Preview, PreviewScene, PreviewStep } from './preview.ts';
export { printPreview } from './preview.ts';
export type {
  BarDisplayClient,
  BarElements,
  RunBarAppOptions,
  SignalSource,
} from './run-bar-app.ts';
export { DEFAULT_PRIORITY, runBarApp, shutdownSignal } from './run-bar-app.ts';
