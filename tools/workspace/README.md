# workspace

Workspace tooling, published in the workspace as `@busy-bar-apps/workspace`.
Nx loads it straight from source.

## Owns

- The Nx Python plugin ([src/plugins/python.ts](src/plugins/python.ts)):
  inferred `lint`, `typecheck`, `test`, `start`, and `preview` targets for
  every Python project, and graph edges from `pyproject.toml` and from
  imports of other workspace members
  ([docs/python.md](../../docs/python.md#the-nx-python-plugin)).
- The project check's rules ([src/checks/project-check.ts](src/checks/project-check.ts)):
  one `type:*` and one `lang:*` tag per project, the targets each tag
  requires, dependency edges that follow `project-boundaries.mjs`, and exact
  pins in every `package.json` and `pyproject.toml`. They are pure functions
  of the project graph and the manifests, tested with hand-built ones.
- The project generator ([src/generators/project/](src/generators/project/)):
  `nx g @busy-bar-apps/workspace:project`. Its templates live in
  `files/<language>-<type>/`; each file ends in `.template` so no tool treats
  it as source.

## Does Not Own

- Lint, test, and format configuration: `eslint.factory.mjs`,
  `vitest.factory.mjs`, and the root `pyproject.toml`.
- Running the project check on the real workspace: `scripts/check-projects.mjs`
  reads the graph and the manifests, and `nx run repo:check-projects` runs it.
- The dependency rules themselves: `project-boundaries.mjs`.

## Start Here

- Changing a template: generate a throwaway project of that variant, run
  `nx run-many -t lint typecheck test -p <name>` and `yarn format:check`, then
  delete it. Generated projects must pass on first run; the weekly CI run's
  Generated projects job checks all four variants.
- New Python projects copy the `[build-system]` table of
  `libs/bar-kit-py/pyproject.toml`, so Dependabot's bumps reach them too.
- Changing inferred targets: update [docs/python.md](../../docs/python.md) in
  the same change.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p workspace
```
