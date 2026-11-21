# Infer Python Targets With a Local Nx Plugin

- Status: Accepted
- Date: 2026-10-19
- Area: Nx tooling for Python

## Context

As of October 2026 Nx has no official Python plugin; its 2026 roadmap lists
Python support as planned. The established community plugin, `@nxlv/python`
(23.x), supports uv workspaces, but:

- It adds dependency edges from `pyproject.toml` and lock-file external nodes,
  yet it does not infer tasks. Each project carries generated `project.json`
  targets, unlike the TypeScript side, where `@nx/js`, `@nx/eslint`,
  `@nx/oxlint`, and `@nx/vitest` infer everything.
- Its generators default to Poetry and flake8, and its executors wrap uv
  commands we would call directly.
- It brings a large dependency tree (tree-sitter WebAssembly, archiver,
  lodash, and others) into a workspace that installs nothing without a
  reason.

## Decision

Keep a local inference plugin in
[tools/workspace/src/plugins/python.ts](../../tools/workspace/src/plugins/python.ts):

- `createNodes` turns each `{apps,libs,tools}/*/pyproject.toml` into a project
  with cached `lint` (Ruff), `typecheck` (mypy), and `test` (pytest) targets,
  plus a `start` target for packages with a `__main__.py`, all run through
  `uv run`.
- `createDependencies` adds a static edge for each requirement that names a
  workspace member.
- The plugin fails the graph when a `pyproject.toml` is not a uv workspace
  member.

It depends only on `@nx/devkit`, `smol-toml`, and the workspace's
`json-values` library, and is covered by tests.

## Consequences

- Python projects need only `pyproject.toml` and a `project.json` with name
  and tags, mirroring TypeScript projects.
- The repository owns about 300 lines of plugin code and its tests.
- External PyPI packages are not graph nodes; `uv.lock` is an input of every
  Python task instead, so any lock change reruns them.

## Revisit

Revisit when Nx ships official Python support, or when per-package lock
hashing (as `@nxlv/python`'s `externalNodes` provides) would save meaningful
CI time.
