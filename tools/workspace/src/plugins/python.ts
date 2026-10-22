// Nx plugin for the Python projects in the uv workspace. Every
// `{apps,libs,tools}/<name>/pyproject.toml` becomes a project with inferred
// targets that run the root dev tools through `uv run`, and every dependency
// on another workspace member becomes a project graph edge. See
// docs/python.md.

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  CreateDependencies,
  CreateNodes,
  CreateNodesResult,
  RawProjectGraphDependency,
  TargetConfiguration,
} from '@nx/devkit';
import {
  createNodesFromFiles,
  DependencyType,
  offsetFromRoot,
} from '@nx/devkit';

import type { PyprojectInfo } from './pyproject.ts';
import { readPyproject, readWorkspaceMembers } from './pyproject.ts';

export const name = '@busy-bar-apps/workspace/python';

const PYPROJECT_GLOB = '{apps,libs,tools}/*/pyproject.toml';
const PROJECT_ROOT = /^(apps|libs|tools)\/[^/]+$/;

// The shared tool versions (uv.lock), their configuration (root
// pyproject.toml), and the interpreter decide every Python task's result.
const PYTHON_GLOBALS = [
  '{workspaceRoot}/.python-version',
  '{workspaceRoot}/pyproject.toml',
  '{workspaceRoot}/uv.lock',
];

export const createNodes: CreateNodes = [
  PYPROJECT_GLOB,
  (files, options, context) => {
    if (files.length === 0) {
      return [];
    }
    const members = new Set(
      readWorkspaceMembers(join(context.workspaceRoot, 'pyproject.toml')),
    );
    return createNodesFromFiles(
      (file) => createPythonProject(file, members, context.workspaceRoot),
      files,
      options,
      context,
    );
  },
];

export const createNodesV2 = createNodes;

function createPythonProject(
  file: string,
  members: ReadonlySet<string>,
  workspaceRoot: string,
): CreateNodesResult {
  const root = dirname(file);
  if (!members.has(root)) {
    // Outside the workspace, `uv run` would quietly create a second virtual
    // environment inside the project instead of using the shared one.
    throw new Error(
      `${root} has a pyproject.toml but is not a uv workspace member. ` +
        `Add "${root}" to [tool.uv.workspace].members in the root ` +
        'pyproject.toml, then run `uv lock`.',
    );
  }

  const pyproject = readPyproject(join(workspaceRoot, file));
  const hasTests = existsSync(join(workspaceRoot, root, 'tests'));
  const sourceDirs = hasTests ? 'src tests' : 'src';
  const rootConfig = `${offsetFromRoot(root)}pyproject.toml`;

  const targets: Record<string, TargetConfiguration> = {
    lint: uvTarget(root, 'ruff check', 'Lint with Ruff.', ['default']),
    typecheck: uvTarget(
      root,
      `mypy --config-file=${rootConfig} ${sourceDirs}`,
      'Type-check with mypy in strict mode.',
      ['default', '^production'],
    ),
  };

  if (hasTests) {
    targets['test'] = {
      ...uvTarget(
        root,
        // --rootdir keeps .pytest_cache per project, so parallel test tasks
        // never share one.
        'pytest --rootdir=. --cov --cov-report=term-missing --cov-report=html:coverage/html',
        'Run pytest and enforce the coverage threshold in pyproject.toml.',
        ['default', '^production'],
      ),
      outputs: ['{projectRoot}/coverage'],
    };
  }

  const isApp = hasModule(workspaceRoot, root, pyproject, '__main__');
  if (isApp) {
    targets['start'] = {
      command: `uv run python -m ${pyproject.moduleName}`,
      options: { cwd: root },
      continuous: true,
      metadata: {
        description: `Run the app (python -m ${pyproject.moduleName}).`,
        technologies: ['python'],
      },
    };
  }

  // Only apps preview: bar-kit-py's `preview` module is the contract, not an
  // entry point.
  if (isApp && hasModule(workspaceRoot, root, pyproject, 'preview')) {
    targets['preview'] = {
      command: `uv run python -m ${pyproject.moduleName}.preview`,
      options: { cwd: root },
      metadata: {
        description:
          'Print sample frames for the app catalogue (tools/catalogue).',
        technologies: ['python'],
      },
    };
  }

  return {
    projects: {
      [root]: {
        name: basename(root),
        root,
        sourceRoot: `${root}/src`,
        projectType: root.startsWith('apps/') ? 'application' : 'library',
        targets,
      },
    },
  };
}

function uvTarget(
  root: string,
  command: string,
  description: string,
  inputs: string[],
): TargetConfiguration {
  return {
    command: `uv run ${command}`,
    options: { cwd: root },
    cache: true,
    // No npm package affects a Python task. Without this, Nx would hash every
    // npm package for a command target and rerun on any yarn.lock change.
    inputs: [...inputs, ...PYTHON_GLOBALS, { externalDependencies: [] }],
    outputs: [],
    metadata: { description, technologies: ['python'] },
  };
}

function hasModule(
  workspaceRoot: string,
  root: string,
  pyproject: PyprojectInfo,
  module: string,
): boolean {
  return existsSync(
    join(workspaceRoot, root, 'src', pyproject.moduleName, `${module}.py`),
  );
}

/**
 * Add a static edge from each Python project to every workspace member it
 * requires, so `nx affected` and task ordering follow pyproject.toml.
 */
export const createDependencies: CreateDependencies = (_options, context) => {
  const pythonProjects = Object.entries(context.projects).flatMap(
    ([projectName, project]) => {
      const file = join(context.workspaceRoot, project.root, 'pyproject.toml');
      return PROJECT_ROOT.test(project.root) && existsSync(file)
        ? [{ projectName, root: project.root, pyproject: readPyproject(file) }]
        : [];
    },
  );

  const projectByDistribution = new Map(
    pythonProjects.map(({ projectName, pyproject }) => [
      pyproject.name,
      projectName,
    ]),
  );

  return pythonProjects.flatMap(
    ({ projectName, root, pyproject }): RawProjectGraphDependency[] =>
      [...new Set(pyproject.requirements)].flatMap((requirement) => {
        const target = projectByDistribution.get(requirement);
        return target === undefined || target === projectName
          ? []
          : [
              {
                source: projectName,
                target,
                type: DependencyType.static,
                sourceFile: `${root}/pyproject.toml`,
              },
            ];
      }),
  );
};
