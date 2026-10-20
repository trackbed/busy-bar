# Project Structure

Status: Current.

## Layout

```text
apps/<name>/       Runnable BUSY Bar apps
libs/<name>/       Shared libraries
tools/workspace/   Nx plugin for Python projects and the project generator
docs/              Guides and ADRs
scripts/           Repository scripts
```

TypeScript and Python projects sit side by side in `apps/` and `libs/`. A
`package.json` makes a directory a TypeScript project; a `pyproject.toml` makes
it a Python project. Every project also has a `project.json` that holds its Nx
name and tags.

## Creating a Project

Use the generator. It writes a project that passes lint, type checking, and
tests, adds it to the Yarn or uv workspace, and updates `tsconfig.json`
references or the uv members list:

```sh
NX_DAEMON=false yarn nx g @busy-bar-apps/workspace:project <name> --language=ts|python [--type=app|lib]
```

`--type` defaults to `app`. Generated apps depend on the language's kit and
draw their own name, so `nx run <name>:start` works at once.

The generator refuses a name that another project already uses in either
language, a reserved word, and a Python name that Python can already import.
A standard-library module or installed package would shadow the new package,
so an app named `calendar` would run Python's own `calendar` module.

## Naming

- **Directory and Nx project**: the same kebab-case name, unique across both
  languages. When a library exists in both languages, the Python directory
  takes a `-py` suffix (`libs/bar-kit` and `libs/bar-kit-py`).
- **TypeScript**: package `@busy-bar-apps/<name>`, kebab-case file names, tests
  next to the code as `<file>.test.ts`.
- **Python**: distribution name without the `-py` suffix (`bar-kit`), import
  name in snake_case (`bar_kit`) under `src/`, tests in `tests/test_*.py`.

## Tags

Every project carries exactly one tag from each family. The rules live in
[project-boundaries.mjs](../project-boundaries.mjs).

| Tag            | Meaning                               | May depend on              |
| -------------- | ------------------------------------- | -------------------------- |
| `type:app`     | A runnable BUSY Bar app               | `type:lib`                 |
| `type:lib`     | Shared code                           | `type:lib`                 |
| `type:tooling` | Workspace tooling and the root `repo` | `type:lib`, `type:tooling` |
| `lang:ts`      | TypeScript, built on Node.js          | `lang:ts`                  |
| `lang:python`  | Python                                | `lang:python`              |

Two checks enforce the rules: ESLint's `@nx/enforce-module-boundaries` on
TypeScript imports, and `NX_DAEMON=false yarn nx run repo:check-projects` on
every project graph edge, including the ones the Python plugin reads from
`pyproject.toml`. Use the tags to select projects:
`nx run-many -t test -p tag:lang:python`.

Add a tag family only when it enables a dependency rule the current tags
cannot express.

## Depending on Another Project

- **TypeScript**: add `"@busy-bar-apps/<name>": "workspace:0.0.1"` to
  `dependencies`, run `yarn install`, import from `@busy-bar-apps/<name>`, then
  run `NX_DAEMON=false yarn nx sync` to update the tsconfig references.
- **Python**: run `uv add --package <dist-name> <other-dist-name>`. uv adds the
  requirement and the `{ workspace = true }` source, and relocks.

## Public APIs

- TypeScript libraries export from `src/index.ts`, naming each export
  explicitly; the package's `exports` points at the source.
- Python libraries re-export from `__init__.py` and list the names in
  `__all__`. Ship a `py.typed` marker so type checkers trust the annotations.

## Project READMEs

Every project has a README with four parts: what it owns, what it does not
own, where to start reading, and how to verify it. The generator writes one.
