# Python

Status: Current.

## Toolchain

| Tool           | Version   | Pinned in                                    |
| -------------- | --------- | -------------------------------------------- |
| Python         | 3.14      | `.python-version`, `requires-python`         |
| uv             | ≥ 0.11.23 | `[tool.uv] required-version`; CI uses 0.13.0 |
| Ruff           | 0.17.0    | root `pyproject.toml` `dev` group            |
| mypy           | 2.4.0     | root `pyproject.toml` `dev` group            |
| pytest         | 9.1.1     | root `pyproject.toml` `dev` group            |
| pytest-asyncio | 1.4.0     | root `pyproject.toml` `dev` group            |
| pytest-cov     | 7.1.0     | root `pyproject.toml` `dev` group            |

uv installs Python 3.14 itself if it is missing.

## The uv Workspace

The root `pyproject.toml` is a virtual workspace root: it is not a package. It
holds three things:

- `[dependency-groups] dev`: the shared tools above.
- `[tool.uv.workspace] members`: every Python project, listed one by one.
  `apps/` and `libs/` also contain TypeScript projects, and uv rejects a glob
  that matches a directory without a `pyproject.toml`. The generator maintains
  the list.
- Tool configuration that every project inherits: `[tool.ruff]`, `[tool.mypy]`,
  and `[tool.pytest]`.

All members share one lockfile (`uv.lock`) and one environment (`.venv/`).
`uv sync --all-packages` installs everything, which also gives editors the
interpreter at `.venv/bin/python`.

Because the environment is shared, a project can import a package that only a
different project declares. It works locally and breaks wherever the project
runs alone, so declare every import in the project's own `pyproject.toml`.

## Project Anatomy

```text
pyproject.toml   [project] metadata and dependencies, uv_build backend,
                 [tool.coverage] settings with the coverage threshold
project.json     Nx name and tags
src/<module>/    The package, with a py.typed marker
tests/           pytest tests (test_*.py)
```

An app is a library with `src/<module>/__main__.py`; `python -m <module>`
starts it. Its `src/<module>/preview.py` prints sample frames for the app
catalogue ([tools/catalogue](../tools/catalogue/README.md)).

## The Nx Python Plugin

[tools/workspace/src/plugins/python.ts](../tools/workspace/src/plugins/python.ts)
turns every `{apps,libs,tools}/<name>/pyproject.toml` into an Nx project
([ADR 0002](adr/0002-local-python-nx-plugin.md)). Each target runs with the
project directory as its working directory:

| Target      | Command                                      | Inferred when                                     |
| ----------- | -------------------------------------------- | ------------------------------------------------- |
| `lint`      | `uv run ruff check`                          | always                                            |
| `typecheck` | `uv run mypy --config-file=<root> src tests` | always                                            |
| `test`      | `uv run pytest --rootdir=. --cov ...`        | the project has `tests/`                          |
| `start`     | `uv run python -m <module>`                  | `src/<module>/__main__.py` exists                 |
| `preview`   | `uv run python -m <module>.preview`          | `src/<module>/preview.py` and `__main__.py` exist |

`lint`, `typecheck`, and `test` are cached. Their inputs are the project's
files, the root `pyproject.toml`, `uv.lock`, and `.python-version`;
`typecheck` and `test` also hash the source of the projects they depend on.

The plugin adds a graph edge for every requirement that names another
workspace member, so `nx affected`, `nx graph`, and `repo:check-projects`
see Python dependencies. It fails the graph with a fix-it message when a
`pyproject.toml` is missing from the members list, because outside the
workspace `uv run` would quietly create a second environment.

## Dependencies

```sh
uv add --package countdown httpx      # adds httpx==<latest> to apps/countdown
uv add --package countdown bar-kit    # a workspace member: also adds the source
uv add --dev pytest-mock              # a shared dev tool, from the root
```

`add-bounds = "exact"` makes `uv add` pin exact versions, and
`exclude-newer = "7 days"` applies the release-age gate. Commit `uv.lock`; CI
installs with `--locked`. Policy → [dependencies.md](dependencies.md).

## Tools

- **Ruff** formats (`yarn format:write`) and lints with the rule set in the
  root `pyproject.toml`. `print` is allowed in apps only; libraries log.
- **mypy** runs in strict mode with `warn_unreachable` and extra error codes.
  busylib is fully annotated but ships without a `py.typed` marker, so the
  config tells mypy to analyse it anyway (`follow_untyped_imports`).
- **pytest** uses its native TOML configuration in strict mode, turns
  warnings into errors, and runs `async def` tests directly
  (`asyncio_mode = "auto"`).

## busylib Gotchas

- `async with create_busy_bar(config) as client:` types `client` as busylib's
  base client, without the display methods. Keep the reference instead:
  `client = create_busy_bar(config)`, then `async with client:`.
- busylib logs every draw at INFO. Apps configure logging at WARNING.
