// Nx plugin for the Python projects in the uv workspace. Every
// `{apps,libs,tools}/<name>/pyproject.toml` becomes a project with inferred
// targets that run the root dev tools through `uv run`, and every dependency
// on another workspace member, declared or imported, becomes a project graph
// edge. See docs/python.md.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  CreateDependencies,
  CreateDependenciesContext,
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

/**
 * One Nx project per workspace member's pyproject.toml, with its inferred
 * targets. Fails the graph for a pyproject.toml that is not a uv workspace
 * member.
 */
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
 * requires in pyproject.toml or imports in its Python files, so
 * `nx affected`, task ordering, and `repo:check-projects` follow both.
 *
 * The members share one environment, so importing a member the project does
 * not require works locally and breaks wherever the project runs alone. The
 * graph fails on such an import, with the command that declares it.
 */
export const createDependencies: CreateDependencies = (_options, context) => {
  const pythonProjects = Object.entries(context.projects).flatMap(
    ([projectName, project]): PythonProject[] => {
      const file = join(context.workspaceRoot, project.root, 'pyproject.toml');
      return PROJECT_ROOT.test(project.root) && existsSync(file)
        ? [{ projectName, root: project.root, pyproject: readPyproject(file) }]
        : [];
    },
  );

  const byDistribution = new Map(
    pythonProjects.map((project) => [project.pyproject.name, project]),
  );
  const byModule = new Map(
    pythonProjects.map((project) => [project.pyproject.moduleName, project]),
  );

  return pythonProjects.flatMap((project) => {
    const declared = requirementEdges(project, byDistribution);
    const required = new Set(declared.map(({ target }) => target));
    return [...declared, ...importEdges(project, byModule, required, context)];
  });
};

interface PythonProject {
  readonly projectName: string;
  readonly root: string;
  readonly pyproject: PyprojectInfo;
}

/** One edge per workspace member that `project`'s pyproject.toml requires. */
function requirementEdges(
  { projectName, root, pyproject }: PythonProject,
  byDistribution: ReadonlyMap<string, PythonProject>,
): RawProjectGraphDependency[] {
  const targets = new Set(
    pyproject.requirements.flatMap((requirement) => {
      const target = byDistribution.get(requirement);
      return target === undefined || target.projectName === projectName
        ? []
        : [target.projectName];
    }),
  );
  return [...targets].map((target) => ({
    source: projectName,
    target,
    type: DependencyType.static,
    sourceFile: `${root}/pyproject.toml`,
  }));
}

/**
 * One edge per workspace member each of `project`'s Python files imports.
 * Throws when a file imports a member that `required` does not hold.
 */
function importEdges(
  { projectName, root, pyproject }: PythonProject,
  byModule: ReadonlyMap<string, PythonProject>,
  required: ReadonlySet<string>,
  context: CreateDependenciesContext,
): RawProjectGraphDependency[] {
  const edges: RawProjectGraphDependency[] = [];
  for (const { file } of context.fileMap.projectFileMap[projectName] ?? []) {
    if (!file.endsWith('.py')) {
      continue;
    }
    const source = readFileSync(join(context.workspaceRoot, file), 'utf8');
    for (const module of new Set(importedModules(source))) {
      const target = byModule.get(module);
      if (target === undefined || target.projectName === projectName) {
        continue;
      }
      if (!required.has(target.projectName)) {
        throw new Error(
          `${file} imports ${module} from ${target.root}, but ${root}/pyproject.toml does not require ${target.pyproject.name}. ` +
            `If project-boundaries.mjs allows the dependency, declare it with \`uv add --package ${pyproject.name} ${target.pyproject.name}\`; see docs/python.md.`,
        );
      }
      edges.push({
        source: projectName,
        target: target.projectName,
        type: DependencyType.static,
        sourceFile: file,
      });
    }
  }
  return edges;
}

// `import a.b, c as d` and `from a.b import c`, at the start of a line.
// Relative imports (`from . import x`) stay inside the package.
const IMPORT = /^[ \t]*import[ \t]+([\w. \t,]+)/gm;
const FROM_IMPORT = /^[ \t]*from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b/gm;

/** The top-level modules a Python source file imports. */
export function importedModules(source: string): string[] {
  const plain = [...source.matchAll(IMPORT)].flatMap(([, names = '']) =>
    names
      .split(',')
      .flatMap((name) => name.trim().split(/[ \t.]/, 1))
      .filter((name) => name !== ''),
  );
  const from = [...source.matchAll(FROM_IMPORT)].flatMap(([, module = '']) => [
    module,
  ]);
  return [...plain, ...from];
}
