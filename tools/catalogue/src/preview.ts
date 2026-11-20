// The JSON an app's `preview` target prints: the shape of `Preview` in
// libs/bar-kit and libs/bar-kit-py. Elements stay unchecked here; the
// emulator validates them the way the bar does.

import type { JsonObject } from '@busy-bar-apps/json-values';
import { arrayAt, isObject, stringAt } from '@busy-bar-apps/json-values';

import { CatalogueError } from './error.ts';

/** One step of how the app works, as the preview tells it. */
export interface PreviewStep {
  readonly label: string;
  readonly text: string;
}

interface PreviewScene {
  readonly title: string;
  readonly caption: string;
  readonly elements: readonly unknown[];
}

/** What an app's `preview` target prints, once parsed. */
export interface Preview {
  readonly summary: string;
  readonly steps: readonly PreviewStep[];
  readonly scenes: readonly PreviewScene[];
}

/** Parse what `app`'s preview target printed. */
export function parsePreview(app: string, output: string): Preview {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch (error) {
    throw new CatalogueError(`${app}:preview did not print JSON.`, {
      cause: error,
    });
  }
  const invalid = (problem: string): CatalogueError =>
    new CatalogueError(`${app}:preview printed ${problem}.`);
  if (!isObject(json)) {
    throw invalid('something other than an object');
  }
  const text = (object: JsonObject, key: string, where: string): string => {
    const value = stringAt(object, key)?.trim();
    if (!value) {
      throw invalid(`no ${key} for ${where}`);
    }
    return value;
  };
  const objects = (key: string): JsonObject[] => {
    const list = arrayAt(json, key);
    if (list.length === 0 || !list.every(isObject)) {
      throw invalid(`no ${key}, or ${key} that are not objects`);
    }
    return list.filter(isObject);
  };

  return {
    summary: text(json, 'summary', 'the app'),
    steps: objects('steps').map((step, index) => ({
      label: text(step, 'label', `step ${index + 1}`),
      text: text(step, 'text', `step ${index + 1}`),
    })),
    scenes: objects('scenes').map((scene, index) => ({
      title: text(scene, 'title', `scene ${index + 1}`),
      caption: text(scene, 'caption', `scene ${index + 1}`),
      elements: arrayAt(scene, 'elements'),
    })),
  };
}
