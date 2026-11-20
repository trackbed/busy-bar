// The workspace's apps and their `preview` targets, read from the Nx project
// graph, so the catalogue lists every app without keeping a list of its own.

import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ProjectGraph } from '@nx/devkit';

import { isObject, stringAt } from '@busy-bar-apps/json-values';

import { CatalogueError } from './error.ts';

const run = promisify(exec);

const LANGUAGES = { 'lang:ts': 'TypeScript', 'lang:python': 'Python' } as const;

type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES];

/** An app the catalogue shows: a `type:app` project with a `preview` target. */
export interface AppProject {
  readonly name: string;
  /** The project directory, relative to the workspace root. */
  readonly root: string;
  readonly language: Language;
  /** The `preview` target's shell command and its working directory. */
  readonly preview: { readonly command: string; readonly cwd: string };
}

/** Every `type:app` project, by name. */
export function appProjects(graph: ProjectGraph): AppProject[] {
  return Object.values(graph.nodes)
    .filter((node) => node.data.tags?.includes('type:app'))
    .map(({ name, data }): AppProject => {
      const language = (data.tags ?? []).flatMap((tag) =>
        tag === 'lang:ts' || tag === 'lang:python' ? [LANGUAGES[tag]] : [],
      )[0];
      // Nx types target options as `any`; check what the graph holds.
      const options: unknown = data.targets?.['preview']?.options;
      const command = isObject(options)
        ? stringAt(options, 'command')
        : undefined;
      const cwd = isObject(options) ? stringAt(options, 'cwd') : undefined;
      if (language === undefined || command === undefined) {
        throw new CatalogueError(
          `${name} needs a lang:* tag and a preview target that runs a command; see tools/catalogue/README.md.`,
        );
      }
      return {
        name,
        root: data.root,
        language,
        preview: { command, cwd: cwd ?? data.root },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Run an app's preview target and return what it printed. */
export async function runPreview(
  app: AppProject,
  workspaceRoot: string,
): Promise<string> {
  try {
    const { stdout } = await run(app.preview.command, {
      cwd: join(workspaceRoot, app.preview.cwd),
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    const detail =
      isObject(error) && typeof error['stderr'] === 'string'
        ? error['stderr'].trim()
        : String(error);
    throw new CatalogueError(
      `${app.name}:preview failed (${app.preview.command}):\n${detail}`,
      { cause: error },
    );
  }
}
