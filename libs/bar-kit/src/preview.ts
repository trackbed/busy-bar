import type { BarElements } from './run-bar-app.ts';

/** One step of how an app works, such as where its data comes from. */
export interface PreviewStep {
  /** A word or two: `Reads`, `Decides`, `Draws`, `Alerts`, `Controls`. */
  readonly label: string;
  readonly text: string;
}

/** One moment of an app, drawn by its own render function from sample data. */
export interface PreviewScene {
  /** A few words naming the moment. */
  readonly title: string;
  /** What the bar shows here, and why. */
  readonly caption: string;
  readonly elements: BarElements;
}

/**
 * What the app catalogue shows for an app. Each app's `preview` target
 * prints one with {@link printPreview}; `tools/catalogue` draws its scenes
 * with the emulator.
 */
export interface Preview {
  /** One sentence: what the app is for. */
  readonly summary: string;
  /** How the app works, in order. */
  readonly steps: readonly PreviewStep[];
  readonly scenes: readonly PreviewScene[];
}

/** Write a preview to standard output as one line of JSON. */
export function printPreview(
  preview: Preview,
  output: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
): void {
  output.write(`${JSON.stringify(preview)}\n`);
}
