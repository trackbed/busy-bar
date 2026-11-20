// @ts-check
// Dependency rules between projects, keyed by tag. Every project carries one
// `type:*` tag (its layer) and one `lang:*` tag (its language); see
// docs/project-structure.md#tags. ESLint enforces these rules on TypeScript
// imports, and `repo:check-projects` enforces them on every project graph
// edge, including the ones the Python plugin finds in pyproject.toml and in
// Python imports.

/** @typedef {{ sourceTag: string, onlyDependOnLibsWithTags: string[] }} DepConstraint */

export const TYPE_TAGS = ['type:app', 'type:lib', 'type:tooling'];
export const LANG_TAGS = ['lang:ts', 'lang:python'];

/** @type {DepConstraint[]} */
export const depConstraints = [
  // Apps compose libs. Nothing depends on an app.
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
  { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
  // Workspace tooling (Nx plugins, generators) may reuse libs.
  {
    sourceTag: 'type:tooling',
    onlyDependOnLibsWithTags: ['type:lib', 'type:tooling'],
  },
  // A project only depends on projects written in its own language.
  { sourceTag: 'lang:ts', onlyDependOnLibsWithTags: ['lang:ts'] },
  { sourceTag: 'lang:python', onlyDependOnLibsWithTags: ['lang:python'] },
];
