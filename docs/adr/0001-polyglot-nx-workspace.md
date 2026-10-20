# One Nx Workspace for TypeScript and Python Apps

- Status: Accepted
- Date: 2026-10-19
- Area: Workspace architecture

## Context

BUSY Bar apps are small host-side programs. The official clients exist for
both TypeScript (`@busy-app/busy-lib`) and Python (`busylib`), and apps in
either language need the same plumbing: connection settings, a frame loop, and
clean shutdown. The setup copies the conventions of the Discera monorepo,
which is TypeScript-only.

## Decision

- One Nx 23 workspace holds both languages. TypeScript projects use Yarn 4
  workspaces with exact pins; Python projects use a uv workspace with one
  lockfile and one shared environment.
- Projects of both languages share `apps/` and `libs/`. The language is
  recorded in a `lang:*` tag rather than in the directory layout, and each
  project keeps its language's native layout (`package.json` and `src/`, or
  `pyproject.toml`, `src/<module>/`, and `tests/`).
- Each language gets a kit with the same environment contract
  (`BUSYBAR_ADDR`, `BUSYBAR_TOKEN`) and the same frame-loop behavior.
- Every project has a `project.json` with its Nx name and tags, so both
  languages follow one convention for identity and boundaries.

## Consequences

- One graph, one `nx affected`, one CI pipeline, and one set of boundary rules
  across both languages.
- uv cannot glob the members list because TypeScript directories have no
  `pyproject.toml`; the generator maintains an explicit list and the Python
  plugin fails on omissions.
- Nx project names must be unique across languages, so a library that exists
  in both gets a `-py` directory suffix on the Python side.
- The shared Python environment lets a project import packages it does not
  declare; reviews and docs guard against that.

## Revisit

Revisit if one language's apps need a release process the other cannot share,
or if the Python side grows enough to need per-project environments.
