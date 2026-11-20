// @ts-check
// Checks every project in the Nx graph, in both languages:
// - it has exactly one `type:*` and one `lang:*` tag;
// - it has the targets its tags require, because `nx run-many` and
//   `nx affected` silently skip a project that lacks a target;
// - every graph edge follows the rules in project-boundaries.mjs. ESLint only
//   sees TypeScript imports; this also covers the edges the Python plugin
//   finds in pyproject.toml and in Python imports;
// - every dependency in its package.json or pyproject.toml is pinned to one
//   exact version (docs/dependencies.md#exact-pins).
// The rules themselves, with their tests, are in
// tools/workspace/src/checks/project-check.ts. Run it as
// `nx run repo:check-projects`.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectGraphAsync } from '@nx/devkit';

import {
  depConstraints,
  LANG_TAGS,
  TYPE_TAGS,
} from '../project-boundaries.mjs';
import {
  packageJsonPinProblems,
  projectProblems,
  pyprojectPinProblems,
} from '../tools/workspace/src/checks/project-check.ts';
import {
  readPyproject,
  readWorkspaceMembers,
} from '../tools/workspace/src/plugins/pyproject.ts';

const root = join(import.meta.dirname, '..');
const graph = await createProjectGraphAsync({ exitOnError: true });

const problems = projectProblems(graph, {
  typeTags: TYPE_TAGS,
  langTags: LANG_TAGS,
  depConstraints,
  requiredTargets: {
    'lang:ts': ['lint', 'oxlint', 'typecheck', 'test'],
    'lang:python': ['lint', 'typecheck', 'test'],
    // `preview` feeds the app catalogue (tools/catalogue).
    'type:app': ['start', 'preview'],
  },
  // The workspace root only lints and type-checks its own scripts.
  rootTargets: ['lint', 'typecheck'],
});

const members = new Set(
  readWorkspaceMembers(join(root, 'pyproject.toml')).map(
    (member) => readPyproject(join(root, member, 'pyproject.toml')).name,
  ),
);
for (const node of Object.values(graph.nodes)) {
  const packageJson = join(node.data.root, 'package.json');
  if (existsSync(join(root, packageJson))) {
    problems.push(
      ...packageJsonPinProblems(
        packageJson,
        readFileSync(join(root, packageJson), 'utf8'),
      ),
    );
  }
  const pyproject = join(node.data.root, 'pyproject.toml');
  if (existsSync(join(root, pyproject))) {
    problems.push(
      ...pyprojectPinProblems(
        pyproject,
        readFileSync(join(root, pyproject), 'utf8'),
        members,
      ),
    );
  }
}

if (problems.length > 0) {
  console.error(
    `Project check failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n` +
      'Tag rules: project-boundaries.mjs. Background: docs/project-structure.md#tags. Pins: docs/dependencies.md#exact-pins.',
  );
  process.exit(1);
}

console.log(
  `All ${Object.keys(graph.nodes).length} projects have their tags, targets, allowed dependencies, and exact pins.`,
);
