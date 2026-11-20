// `nx g @busy-bar-apps/workspace:project` creates a BUSY Bar app or library
// that already follows the workspace conventions: tags, lint, type checking,
// tests with coverage thresholds, and a README. See docs/project-structure.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { GeneratorCallback, Tree } from '@nx/devkit';
import {
  generateFiles,
  installPackagesTask,
  names,
  offsetFromRoot,
  updateJson,
} from '@nx/devkit';

export interface ProjectGeneratorOptions {
  readonly name: string;
  readonly language: 'python' | 'ts';
  readonly type?: 'app' | 'lib';
  readonly skipInstall?: boolean;
}

const NAME = /^[a-z][a-z\d]*(-[a-z\d]+)*$/;
const MEMBERS = /^members\s*=\s*\[([^\]]*)\]/m;
const QUOTED = /["']([^"']+)["']/g;
const PROJECT_DIRECTORIES = ['apps', 'libs', 'tools'];

// A TypeScript library exports a function named after the project, and a
// Python project is imported by its name, so neither may be a reserved word.
const JS_RESERVED = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(
    ' ',
  ),
);
const PYTHON_KEYWORDS = new Set(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' ',
  ),
);

/**
 * Write a new app or library in `apps/` or `libs/` from the templates in
 * `files/<language>-<type>/`, then wire it into the Yarn or uv workspace. The
 * returned callback installs dependencies unless `skipInstall` is set.
 */
export function projectGenerator(
  tree: Tree,
  options: ProjectGeneratorOptions,
): GeneratorCallback {
  const { name, language, type = 'app', skipInstall = false } = options;
  if (!NAME.test(name)) {
    throw new Error(
      `Project names are kebab-case, such as "weather"; got ${JSON.stringify(name)}.`,
    );
  }

  // Nx project names are unique across both languages.
  const taken = PROJECT_DIRECTORIES.map((parent) => `${parent}/${name}`).find(
    (path) => tree.exists(path),
  );
  if (taken !== undefined) {
    throw new Error(
      `${taken} already exists, and project names are unique across languages.`,
    );
  }

  const { propertyName } = names(name);
  const moduleName = name.replaceAll('-', '_');
  if (language === 'ts' && JS_RESERVED.has(propertyName)) {
    throw new Error(`"${name}" is a reserved word in JavaScript.`);
  }
  if (language === 'python') {
    assertPythonModuleIsFree(tree.root, moduleName);
  }

  const directory = `${type === 'app' ? 'apps' : 'libs'}/${name}`;
  generateFiles(
    tree,
    join(import.meta.dirname, 'files', `${language}-${type}`),
    directory,
    {
      name,
      directory,
      propertyName,
      moduleName,
      title: name.replaceAll('-', ' ').toUpperCase(),
      offset: offsetFromRoot(directory),
    },
  );

  if (language === 'ts') {
    addTypeScriptReference(tree, directory);
    return () => {
      if (!skipInstall) {
        installPackagesTask(tree, true);
      }
    };
  }

  addUvWorkspaceMember(tree, directory);
  return () => {
    if (!skipInstall) {
      execFileSync('uv', ['lock'], { cwd: tree.root, stdio: 'inherit' });
    }
  };
}

/**
 * Reject a Python package name that is a keyword or that Python can already
 * import. A standard-library module or an installed package of the same name
 * comes first on `sys.path`, so `python -m <name>` would run it instead.
 */
function assertPythonModuleIsFree(root: string, moduleName: string): void {
  if (PYTHON_KEYWORDS.has(moduleName)) {
    throw new Error(`"${moduleName}" is a keyword in Python.`);
  }
  const probe = spawnSync(
    'uv',
    [
      'run',
      '--quiet',
      'python',
      '-c',
      'import importlib.util, sys; sys.exit(importlib.util.find_spec(sys.argv[1]) is not None)',
      moduleName,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (probe.status === 1) {
    throw new Error(
      `Python already has a module named ${moduleName} (in the standard library or an installed package), which would shadow the new project. Pick another name.`,
    );
  }
  if (probe.status !== 0) {
    throw new Error(
      `Could not check the module name with uv; is uv installed? ${probe.error?.message ?? probe.stderr}`,
    );
  }
}

/** Reference the new project from the solution tsconfig.json. */
function addTypeScriptReference(tree: Tree, directory: string): void {
  updateJson<{ references?: { path: string }[] }>(
    tree,
    'tsconfig.json',
    (tsconfig) => ({
      ...tsconfig,
      references: [...(tsconfig.references ?? []), { path: `./${directory}` }],
    }),
  );
}

/**
 * Add the project to `[tool.uv.workspace].members`, keeping the list sorted.
 * Edits the text so the file's comments survive.
 */
export function addUvWorkspaceMember(tree: Tree, directory: string): void {
  const source = tree.read('pyproject.toml', 'utf8') ?? '';
  if (!MEMBERS.test(source)) {
    throw new Error(
      'The root pyproject.toml must declare [tool.uv.workspace].members; see docs/python.md.',
    );
  }

  const updated = source.replace(MEMBERS, (_members, list: string) => {
    const members = Array.from(list.matchAll(QUOTED), ([, member]) => member);
    const sorted = [
      ...new Set([
        ...members.filter((member) => member !== undefined),
        directory,
      ]),
    ].sort();
    return `members = [\n${sorted.map((member) => `  "${member}",\n`).join('')}]`;
  });
  tree.write('pyproject.toml', updated);
}
