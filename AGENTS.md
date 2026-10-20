# BUSY Bar apps

Nx monorepo of BUSY Bar apps in TypeScript and Python. Apps run on a computer
or server and draw on the bar through its HTTP API with the official `busylib`
clients. TypeScript uses Yarn workspaces; Python uses a uv workspace.

# First Read

- This file holds the always-on rules. [docs/README.md](docs/README.md) indexes
  everything else.
- Use the pinned Node version (`.node-version`; `nvm install` switches to it),
  then install before any Nx command: `corepack enable && yarn install && uv sync --all-packages`.
- `yarn bootstrap:status` is a read-only readiness check. Run it first when
  Nx or a tool fails in a way that looks environmental. If Yarn cannot launch
  scripts, run `node scripts/check-workspace-ready.mjs` directly.

# Hard Rules

These apply to every task. Break one only when the user names a concrete reason.

- **Nx**: run every Nx command as `NX_DAEMON=false yarn nx ...`. A stale daemon
  gives stale graphs and affected sets in short-lived agent shells. Prefer
  `nx run`, `nx run-many`, and `nx affected` over calling the tools directly.
  Never guess CLI flags; check `--help` or the Nx docs.
- **New projects**: create them with
  `NX_DAEMON=false yarn nx g @busy-bar-apps/workspace:project <name> --language=ts|python [--type=lib]`.
  It applies every convention below; hand-made projects drift.
- **Boundaries**: every project has exactly one `type:*` tag (`app`, `lib`,
  `tooling`) and one `lang:*` tag (`ts`, `python`). Apps depend only on libs,
  and nothing depends on an app. ESLint enforces this on TypeScript imports;
  `repo:check-projects` enforces it on every graph edge, Python included, and
  fails when a project lacks the targets its tags require.
  Rules live in [project-boundaries.mjs](project-boundaries.mjs).
- **TypeScript runs from source**: Node 24 strips types at runtime, so code
  must use erasable syntax only (no `enum`, `namespace`, or constructor
  parameter properties), relative imports must end in `.ts`, and type-only
  imports must use `import type`. `tsc` is TypeScript 7; the `typescript`
  package is the TypeScript 6 API that ESLint and Nx load. Why → [ADR 0003](docs/adr/0003-typescript-from-source.md).
- **TypeScript discipline**: no `any`, no non-null assertions (`!`), and no
  `as` casts to silence the compiler; narrow with runtime checks. Read
  environment variables with bracket access (`process.env['NAME']`).
- **Python**: every Python project is listed in `[tool.uv.workspace].members`
  in the root `pyproject.toml`; the Nx plugin fails the graph otherwise. A
  dependency on another member needs `<name> = { workspace = true }` under
  `[tool.uv.sources]`. mypy runs in strict mode; fix types rather than adding
  `# type: ignore`.
- **Dependencies**: pin exact versions everywhere: no `^` or `~` in
  `package.json`, `==` in `pyproject.toml`, and `workspace:0.0.1` for internal
  TypeScript packages. New releases must be seven days old (Yarn, uv, and
  Dependabot all enforce it). Never bypass the gate or enable install scripts
  without the user's approval. Policy → [docs/dependencies.md](docs/dependencies.md).
- **Suppressions** need a reason: `// eslint-disable-next-line <rule> -- <reason>`
  (lint fails without one) and `# noqa: <CODE> - <reason>`.
- **Ratchet, don't preserve**: never lower a coverage threshold or loosen a
  lint rule to make a change pass.
- **Greenfield posture**: aim for the cleanest end state. Replace obsolete
  code directly; add no compatibility shims or migration scaffolding unless
  the user names a constraint.
- **Agent instructions** belong in this file. `CLAUDE.md` only imports it.
- **Git**: `main` changes only through squash-merged pull requests that pass
  the `CI` check; the repository ruleset blocks direct pushes, force-pushes,
  and deletion for everyone, admins included. Conventional Commits
  (`feat(scope): …`) only for PR titles, which become the squash commit's
  subject. Branch commits use plain descriptive messages.
- **Guardrails earn their keep**: add a new checker, rule, or doc only for a
  real or plausible mistake that existing tools cannot catch. Prefer
  extending what exists.

# Where the Code Lives

- `apps/<name>/`: runnable BUSY Bar apps. TypeScript apps keep the drawing in
  `src/render*.ts` and the wiring in `src/main.ts`; Python apps keep it in
  `src/<module>/render.py` and `src/<module>/__main__.py`.
- `libs/bar-kit/` (TypeScript) and `libs/bar-kit-py/` (Python): connection
  settings (`BUSYBAR_ADDR`, `BUSYBAR_TOKEN`), display sizes, `rgba()`, the
  frame loop (`runBarApp` / `run_bar_app`), background polling
  (`createPoller` / `Poller`), and text that fits the bitmap fonts
  (`toBarText`, `textWidth`, `fitText`). The two kits share one contract;
  change both together.
- `tools/emulator/`: a BUSY Bar on the computer, built from the open
  firmware: the HTTP API, both displays with animations, and a browser page.
  Start it with `NX_DAEMON=false yarn nx run emulator:start` and point an app
  at it with `BUSYBAR_ADDR=127.0.0.1:8080`.
- `tools/workspace/`: the Nx plugin that infers Python targets and graph edges
  (`src/plugins/python.ts`) and the project generator (`src/generators/project/`).
- Root: `nx.json`, `project-boundaries.mjs`, `eslint.factory.mjs`,
  `vitest.factory.mjs`, and `pyproject.toml` (uv workspace plus Ruff, mypy,
  and pytest config).

Full layout, naming, and tags → [docs/project-structure.md](docs/project-structure.md).

# Trigger → Doc Resolver

- BUSY Bar API, displays, fonts, connecting → [docs/busy-bar.md](docs/busy-bar.md). Text must be printable ASCII; the front display is 72×16 and apps draw on 148×80 of the back.
- Checking an app without a bar, or the bar's exact behaviour → [tools/emulator/README.md](tools/emulator/README.md).
- New app or library, tags, naming → [docs/project-structure.md](docs/project-structure.md).
- TypeScript config, runtime, ESLint, Vitest → [docs/typescript.md](docs/typescript.md).
- Python, uv, Ruff, mypy, pytest, the Nx Python plugin → [docs/python.md](docs/python.md).
- Commands, verification tiers, Git hooks, CI → [docs/command-reference.md](docs/command-reference.md).
- Tests and coverage → [docs/testing-strategy.md](docs/testing-strategy.md).
- Adding or upgrading a dependency → [docs/dependencies.md](docs/dependencies.md).
- `.github/workflows/*.yml` or `.github/actions/**`: run actionlint and zizmor locally; commands in [docs/command-reference.md#ci](docs/command-reference.md#ci).
- Decisions and their history → [docs/adr/README.md](docs/adr/README.md).

# Post-Change Requirements

- Added, removed, or rewired a TypeScript project: run `NX_DAEMON=false yarn nx sync` and commit the tsconfig changes. CI runs `nx sync:check`.
- Changed Python dependencies: run `uv lock` and commit `uv.lock`. CI installs with `--locked`.
- Changed `package.json` dependencies: run `yarn install` and commit `yarn.lock`.
- Changed a kit's public behavior: update the other language's kit and both READMEs.

# Verification Matrix

- While iterating on one project: `NX_DAEMON=false yarn nx run-many -t lint typecheck test -p <project>`.
- Broader changes: `yarn verify:fast`.
- Before the branch's first push or PR: `yarn verify` once. After that, CI runs it on every push; fix failures with the failing target, not another full sweep.
- Docs-only change: `yarn format:check`.
- Workflow change: actionlint and zizmor (see [docs/command-reference.md#ci](docs/command-reference.md#ci)).

# Documentation Policy

- Keep docs in sync with code in the same change. A stale doc is a review finding.
- Every project README states what it owns, what it does not own, where to start, and how to verify it.
- Record decisions with lasting consequences as ADRs ([docs/adr/README.md](docs/adr/README.md)).
