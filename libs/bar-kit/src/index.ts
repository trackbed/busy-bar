// Public API of @busy-bar-apps/bar-kit. Export each name explicitly so the
// package surface stays deliberate.

export type {
  AnimationElement,
  BusySnapshot,
  CountdownElement,
  ImageElement,
  RectangleElement,
  TextElement,
} from '@busy-app/busy-lib';
export { toBarText } from './bar-text.ts';
export { createBusyBar } from './client.ts';
export type { BarConfig } from './config.ts';
export { BarConfigError, loadBarConfig } from './config.ts';
export type { DisplaySize } from './display.ts';
export { BACK_DISPLAY, FRONT_DISPLAY, rgba } from './display.ts';
export type {
  BarDisplay,
  SolidRectangleOptions,
  StatusCellsOptions,
  TextAlign,
  TextElementOptions,
} from './elements.ts';
export {
  colorOf,
  elementsById,
  FOOTER_Y,
  PALETTE,
  solidRectangle,
  statusCells,
  SUMMARY_Y,
  textElement,
  textOf,
} from './elements.ts';
export type { WholeNumberOptions } from './env.ts';
export { envHttpUrl, envSwitch, envWholeNumber, SettingsError } from './env.ts';
export type { BarFont } from './fonts.ts';
export { ELLIPSIS, fitText, overflowingText, textWidth } from './fonts.ts';
export type {
  InputEvent,
  ListenForInputOptions,
  StatusStream,
} from './input.ts';
export { listenForInput } from './input.ts';
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
export {
  DEFAULT_PRIORITY,
  MAX_PRIORITY,
  MIN_PRIORITY,
  runBarApp,
  shutdownSignal,
} from './run-bar-app.ts';
export type { TrackedScreen } from './screen.ts';
export { trackScreen } from './screen.ts';
export type {
  BarAudioClient,
  Speaker,
  SpeakerOptions,
  StockSound,
} from './speaker.ts';
export { createSpeaker, STOCK_SOUNDS } from './speaker.ts';
