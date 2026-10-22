import type { ProjectGraph, ProjectGraphProjectNode } from '@nx/devkit';
import { describe, expect, it } from 'vitest';

import type { AppProject } from './apps.ts';
import { appProjects, runPreview } from './apps.ts';
import { CatalogueError } from './error.ts';

function node(
  name: string,
  tags: string[],
  preview?: Record<string, unknown>,
): ProjectGraphProjectNode {
  return {
    name,
    type: 'app',
    data: {
      root: `apps/${name}`,
      tags,
      targets: preview === undefined ? {} : { preview: { options: preview } },
    },
  };
}

function graph(...nodes: ProjectGraphProjectNode[]): ProjectGraph {
  return {
    nodes: Object.fromEntries(nodes.map((each) => [each.name, each])),
    dependencies: {},
  };
}

describe('appProjects', () => {
  it('lists every app with its language and preview command, by name', () => {
    const projects = appProjects(
      graph(
        node('countdown', ['type:app', 'lang:python'], {
          command: 'uv run python -m countdown.preview',
          cwd: 'apps/countdown',
        }),
        node('bar-kit', ['type:lib', 'lang:ts']),
        node('clock', ['type:app', 'lang:ts'], {
          command: 'node src/preview.ts',
        }),
      ),
    );

    expect(projects).toStrictEqual([
      {
        name: 'clock',
        root: 'apps/clock',
        language: 'TypeScript',
        preview: { command: 'node src/preview.ts', cwd: 'apps/clock' },
      },
      {
        name: 'countdown',
        root: 'apps/countdown',
        language: 'Python',
        preview: {
          command: 'uv run python -m countdown.preview',
          cwd: 'apps/countdown',
        },
      },
    ]);
  });

  it.each([
    ['without a preview target', node('clock', ['type:app', 'lang:ts'])],
    [
      'without a language',
      node('clock', ['type:app'], { command: 'node src/preview.ts' }),
    ],
  ])('refuses an app %s', (_case, app) => {
    expect(() => appProjects(graph(app))).toThrow(CatalogueError);
  });
});

describe('runPreview', () => {
  const app = (command: string): AppProject => ({
    name: 'hello',
    root: 'apps/hello',
    language: 'TypeScript',
    preview: { command, cwd: '.' },
  });

  it('returns what the command printed', async () => {
    await expect(
      runPreview(app(`node -e "process.stdout.write('{}')"`), process.cwd()),
    ).resolves.toBe('{}');
  });

  it('reports what a failing command wrote to standard error', async () => {
    await expect(
      runPreview(
        app(`node -e "console.error('no settings'); process.exit(2)"`),
        process.cwd(),
      ),
    ).rejects.toThrow(/^hello:preview failed \(.*\):\nno settings$/u);
  });
});
