# workspace

Workspace tooling, published in the workspace as `@busy-bar-apps/workspace`.
Nx loads it straight from source.

## Owns

- The Nx Python plugin ([src/plugins/python.ts](src/plugins/python.ts)):
  inferred `lint`, `typecheck`, `test`, `start`, and `preview` targets for
  every Python project, and graph edges from `pyproject.toml`
  ([docs/python.md](../../docs/python.md#the-nx-python-plugin)).
- The project generator ([src/generators/project/](src/generators/project/)):
  `nx g @busy-bar-apps/workspace:project`. Its templates live in
  `files/<language>-<type>/`; each file ends in `.template` so no tool treats
  it as source.

## Does Not Own

- Lint, test, and format configuration: `eslint.factory.mjs`,
  `vitest.factory.mjs`, and the root `pyproject.toml`.
- The project check (tags, required targets, and dependency rules):
  `scripts/check-projects.mjs`.

## Start Here

- Changing a template: generate a throwaway project of that variant, run
  `nx run-many -t lint typecheck test -p <name>` and `yarn format:check`, then
  delete it. Generated projects must pass on first run.
- Changing inferred targets: update [docs/python.md](../../docs/python.md) in
  the same change.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p workspace
```
