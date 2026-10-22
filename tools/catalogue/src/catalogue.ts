// An app's preview turned into catalogue entries: each scene drawn the way
// the bar draws it.

import type { Screenshots } from '@busy-bar-apps/emulator';
import { isObject, stringAt } from '@busy-bar-apps/json-values';

import type { AppProject } from './apps.ts';
import { CatalogueError } from './error.ts';
import type { Preview, PreviewStep } from './preview.ts';

export interface CatalogueScene {
  readonly title: string;
  readonly caption: string;
  /** PNGs of both displays. */
  readonly screenshots: Screenshots;
  /** The text each display shows, for readers who cannot see the images. */
  readonly text: { readonly front: string; readonly back: string };
}

export interface CatalogueApp {
  readonly project: AppProject;
  readonly summary: string;
  readonly steps: readonly PreviewStep[];
  readonly scenes: readonly CatalogueScene[];
}

/** Draws a request body on an idle bar at `now`; see the emulator's `screenshotDraw`. */
export type DrawScene = (body: unknown, now: number) => Promise<Screenshots>;

/** Draw every scene of `preview` as `project`, the way the bar would. */
export async function catalogueApp(
  project: AppProject,
  preview: Preview,
  draw: DrawScene,
  now: number,
): Promise<CatalogueApp> {
  const scenes = await Promise.all(
    preview.scenes.map(async (scene): Promise<CatalogueScene> => {
      const body = { application_name: project.name, elements: scene.elements };
      let screenshots: Screenshots;
      try {
        screenshots = await draw(body, now);
      } catch (error) {
        throw new CatalogueError(
          `${project.name}: the bar would refuse scene "${scene.title}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return {
        title: scene.title,
        caption: scene.caption,
        screenshots,
        text: {
          front: displayText(scene.elements, 'front'),
          back: displayText(scene.elements, 'back'),
        },
      };
    }),
  );
  return {
    project,
    summary: preview.summary,
    steps: preview.steps,
    scenes,
  };
}

/** The texts drawn on `display`, in drawing order. Elements default to the front. */
function displayText(
  elements: readonly unknown[],
  display: 'front' | 'back',
): string {
  return elements
    .flatMap((element) => {
      if (!isObject(element)) {
        return [];
      }
      const text = stringAt(element, 'text');
      const on = stringAt(element, 'display') ?? 'front';
      return text !== undefined && on === display ? [text] : [];
    })
    .join(' ');
}
