// @ts-check
// Checks every project in the Nx graph, in both languages:
// - it has exactly one `type:*` and one `lang:*` tag;
// - it has the targets its tags require, because `nx run-many` and
//   `nx affected` silently skip a project that lacks a target;
// - every graph edge follows the rules in project-boundaries.mjs. ESLint only
//   sees TypeScript imports; this also covers the edges the Python plugin reads
//   from pyproject.toml.
// Run it as `nx run repo:check-projects`.

import { createProjectGraphAsync } from '@nx/devkit';

import {
  depConstraints,
  LANG_TAGS,
  TYPE_TAGS,
} from '../project-boundaries.mjs';

/** @type {Record<string, string[]>} */
const REQUIRED_TARGETS = {
  'lang:ts': ['lint', 'oxlint', 'typecheck', 'test'],
  'lang:python': ['lint', 'typecheck', 'test'],
  'type:app': ['start'],
};
// The workspace root only lints and type-checks its own scripts.
const ROOT_TARGETS = ['lint', 'typecheck'];

const graph = await createProjectGraphAsync({ exitOnError: true });
/** @type {string[]} */
const problems = [];

for (const [name, node] of Object.entries(graph.nodes)) {
  const tags = node.data.tags ?? [];
  for (const family of [TYPE_TAGS, LANG_TAGS]) {
    const matches = tags.filter((tag) => family.includes(tag));
    if (matches.length !== 1) {
      problems.push(
        `${name} must have exactly one of ${family.join(', ')}; it has ${matches.length === 0 ? 'none' : matches.join(', ')}.`,
      );
    }
  }

  const required =
    node.data.root === '.'
      ? ROOT_TARGETS
      : tags.flatMap((tag) => REQUIRED_TARGETS[tag] ?? []);
  const missing = required.filter(
    (target) => node.data.targets?.[target] === undefined,
  );
  if (missing.length > 0) {
    problems.push(
      `${name} has no ${missing.join(', ')} target; check the Nx plugin configuration in nx.json.`,
    );
  }
}

for (const [source, dependencies] of Object.entries(graph.dependencies)) {
  const sourceTags = graph.nodes[source]?.data.tags ?? [];
  for (const { target } of dependencies) {
    const targetNode = graph.nodes[target];
    if (targetNode === undefined) {
      continue; // An npm or PyPI package, not a workspace project.
    }
    const targetTags = targetNode.data.tags ?? [];
    for (const { sourceTag, onlyDependOnLibsWithTags } of depConstraints) {
      if (
        sourceTags.includes(sourceTag) &&
        !onlyDependOnLibsWithTags.some((tag) => targetTags.includes(tag))
      ) {
        problems.push(
          `${source} (${sourceTag}) may only depend on projects tagged ${onlyDependOnLibsWithTags.join(' or ')}, but depends on ${target} (${targetTags.join(', ')}).`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(
    `Project check failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n` +
      'Tag rules: project-boundaries.mjs. Background: docs/project-structure.md#tags.',
  );
  process.exit(1);
}

console.log(
  `All ${Object.keys(graph.nodes).length} projects have their tags, targets, and allowed dependencies.`,
);
