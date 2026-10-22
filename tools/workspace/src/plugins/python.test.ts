import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateDependenciesContext, CreateNodesResult } from '@nx/devkit';
import { AggregateCreateNodesError, DependencyType } from '@nx/devkit';
import { describe, expect, it } from 'vitest';

import { createDependencies, createNodes } from './python.ts';

const [pattern, createNodesFunction] = createNodes;

/** A throwaway workspace; `files` maps workspace paths to contents. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'python-plugin-'));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const ROOT_PYPROJECT = `
[tool.uv.workspace]
members = ["apps/countdown", "libs/bar-kit-py"]
`;
const APP_PYPROJECT = `
[project]
name = "countdown"
dependencies = ["bar-kit", "busylib==2.6.0"]

[dependency-groups]
dev = ["Bar_Kit"]
`;
const LIB_PYPROJECT = `
[project]
name = "bar-kit"
dependencies = ["busylib==2.6.0"]
`;

async function projectsFor(
  workspaceRoot: string,
  files: string[],
): Promise<Record<string, CreateNodesResult['projects']>> {
  const results = await createNodesFunction(files, undefined, {
    nxJsonConfiguration: {},
    workspaceRoot,
  });
  return Object.fromEntries(
    results.map(([file, result]) => [file, result.projects]),
  );
}

describe('createNodes', () => {
  it('matches the pyproject.toml of every app, lib, and tool', () => {
    expect(pattern).toBe('{apps,libs,tools}/*/pyproject.toml');
  });

  it('needs no uv workspace while there are no Python projects', async () => {
    const root = workspace({});

    expect(await projectsFor(root, [])).toEqual({});
  });

  it('infers lint, typecheck, test, start, and preview for an app', async () => {
    const root = workspace({
      'pyproject.toml': ROOT_PYPROJECT,
      'apps/countdown/pyproject.toml': APP_PYPROJECT,
      'apps/countdown/src/countdown/__main__.py': '',
      'apps/countdown/src/countdown/preview.py': '',
      'apps/countdown/tests/test_render.py': '',
    });

    const projects = await projectsFor(root, ['apps/countdown/pyproject.toml']);
    const project =
      projects['apps/countdown/pyproject.toml']?.['apps/countdown'];

    expect(project).toMatchObject({
      name: 'countdown',
      projectType: 'application',
      sourceRoot: 'apps/countdown/src',
    });
    const targets = project?.targets ?? {};
    expect(Object.keys(targets)).toEqual([
      'lint',
      'typecheck',
      'test',
      'start',
      'preview',
    ]);
    expect(targets['lint']).toMatchObject({
      command: 'uv run ruff check',
      options: { cwd: 'apps/countdown' },
      cache: true,
    });
    expect(targets['typecheck']?.command).toBe(
      'uv run mypy --config-file=../../pyproject.toml src tests',
    );
    expect(targets['typecheck']?.inputs).toContain('^production');
    expect(targets['typecheck']?.inputs).toContain('{workspaceRoot}/uv.lock');
    expect(targets['test']?.command).toBe(
      'uv run pytest --rootdir=. --cov --cov-report=term-missing --cov-report=html:coverage/html',
    );
    expect(targets['test']?.outputs).toEqual(['{projectRoot}/coverage']);
    expect(targets['start']).toMatchObject({
      command: 'uv run python -m countdown',
      continuous: true,
    });
    expect(targets['preview']).toMatchObject({
      command: 'uv run python -m countdown.preview',
      options: { cwd: 'apps/countdown' },
    });
  });

  it('infers only lint and typecheck for a lib without tests', async () => {
    const root = workspace({
      'pyproject.toml': ROOT_PYPROJECT,
      'libs/bar-kit-py/pyproject.toml': LIB_PYPROJECT,
      'libs/bar-kit-py/src/bar_kit/__init__.py': '',
      'libs/bar-kit-py/src/bar_kit/preview.py': '',
    });

    const projects = await projectsFor(root, [
      'libs/bar-kit-py/pyproject.toml',
    ]);
    const project =
      projects['libs/bar-kit-py/pyproject.toml']?.['libs/bar-kit-py'];

    expect(project?.projectType).toBe('library');
    expect(Object.keys(project?.targets ?? {})).toEqual(['lint', 'typecheck']);
    expect(project?.targets?.['typecheck']?.command).toBe(
      'uv run mypy --config-file=../../pyproject.toml src',
    );
  });

  it('rejects a Python project that is not a uv workspace member', async () => {
    const root = workspace({
      'pyproject.toml': ROOT_PYPROJECT,
      'libs/stray/pyproject.toml': '[project]\nname = "stray"\n',
    });

    let error: unknown;
    try {
      await createNodesFunction(['libs/stray/pyproject.toml'], undefined, {
        nxJsonConfiguration: {},
        workspaceRoot: root,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateCreateNodesError);
    expect(
      error instanceof AggregateCreateNodesError
        ? String(error.errors[0]?.[1])
        : undefined,
    ).toContain(
      'libs/stray has a pyproject.toml but is not a uv workspace member',
    );
  });
});

describe('createDependencies', () => {
  it('adds one static edge per workspace member a project requires', async () => {
    const root = workspace({
      'pyproject.toml': ROOT_PYPROJECT,
      'apps/countdown/pyproject.toml': APP_PYPROJECT,
      'libs/bar-kit-py/pyproject.toml': LIB_PYPROJECT,
    });
    const context: CreateDependenciesContext = {
      externalNodes: {},
      nxJsonConfiguration: {},
      workspaceRoot: root,
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
      projects: {
        countdown: { root: 'apps/countdown' },
        'bar-kit-py': { root: 'libs/bar-kit-py' },
        clock: { root: 'apps/clock' },
        repo: { root: '.' },
      },
    };

    expect(await createDependencies(undefined, context)).toEqual([
      {
        source: 'countdown',
        target: 'bar-kit-py',
        type: DependencyType.static,
        sourceFile: 'apps/countdown/pyproject.toml',
      },
    ]);
  });
});
