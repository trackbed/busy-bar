# Command Reference

Status: Current.

Run every Nx command with `NX_DAEMON=false` (see [AGENTS.md](../AGENTS.md#hard-rules)).
The root `package.json` scripts default it; export `NX_DAEMON=true` in a human
shell to use the daemon.

## Setup

| Command                  | What it does                                   |
| ------------------------ | ---------------------------------------------- |
| `corepack enable`        | Provide the pinned Yarn                        |
| `yarn install`           | Install Node packages and the Git hooks        |
| `uv sync --all-packages` | Install Python 3.14 and every Python package   |
| `yarn bootstrap:status`  | Read-only readiness check with fix-it commands |

If Yarn cannot launch scripts because dependencies or its install state are
missing, run `node scripts/check-workspace-ready.mjs` directly. It needs only
the pinned Node runtime and prints the commands that repair the environment.

## Everyday

| Command                                                             | What it does                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `NX_DAEMON=false yarn nx run <app>:start`                           | Run an app against the bar                                          |
| `NX_DAEMON=false yarn nx run emulator:start`                        | Start the emulator; run apps with `BUSYBAR_ADDR=127.0.0.1:8080`     |
| `NX_DAEMON=false yarn nx run emulator:pin-firmware -- <sha>`        | Pin the emulator to another firmware commit                         |
| `NX_DAEMON=false yarn nx run-many -t lint typecheck test -p <name>` | Check one project                                                   |
| `NX_DAEMON=false yarn nx run-many -t test -p tag:lang:python`       | Test every Python project                                           |
| `NX_DAEMON=false yarn nx g @busy-bar-apps/workspace:project ...`    | Create a project (see [project-structure.md](project-structure.md)) |
| `NX_DAEMON=false yarn nx show project <name>`                       | Show a project's targets, inputs, and commands                      |
| `NX_DAEMON=false yarn nx graph`                                     | Open the project graph                                              |
| `NX_DAEMON=false yarn nx sync`                                      | Update tsconfig references after wiring changes                     |
| `yarn format:write`                                                 | Format everything (Oxfmt, then Ruff)                                |
| `yarn test:all`, `yarn lint:all`, `yarn typecheck:all`              | Run one target across every project                                 |

Nx caches `lint`, `typecheck`, `test`, and the root `repo` targets. Add
`--skip-nx-cache` to force a rerun.

## Verification Tiers

Both `verify` scripts check formatting, tsconfig references
(`nx sync:check`), and the project check (`repo:check-projects`), then run
targets for the projects
the branch affects compared with `origin/main`.

| Situation                   | Run                                                                    |
| --------------------------- | ---------------------------------------------------------------------- |
| Iterating on one project    | `nx run-many -t lint typecheck test -p <name>`                         |
| Iterating on a wider change | `yarn verify:fast` (adds `lint` and `typecheck` for affected projects) |
| Before the first push or PR | `yarn verify` (also Knip and `test`)                                   |
| Docs only                   | `yarn format:check`                                                    |

Run `yarn verify` once before you push, not after every edit. Once a PR is
open, CI runs the same checks on every push.

## Git Hooks

Lefthook installs one hook, pre-commit, which runs
[scripts/pre-commit-policy.sh](../scripts/pre-commit-policy.sh) on the staged
files: Oxfmt and Oxlint for TypeScript and JSON, Markdown, and YAML, and Ruff
format and lint for Python. It only checks and never rewrites files; it should
finish in seconds.

- Run the policy without committing: `yarn hooks:policy:pre-commit`.
- Reinstall the hooks: `yarn hooks:install`.
- Add personal jobs in a gitignored `lefthook-local.yml`.
- There is deliberately no pre-push hook: run `yarn verify` before the first
  push, and let CI gate merges.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on pull requests,
merge groups, and pushes to `main`:

- **Verify**: formatting, `nx sync:check`, `repo:check-projects`,
  `repo:knip`, and `nx affected -t lint typecheck test`. The Nx cache in
  `~/.nx` is restored between runs. `nrwl/nx-set-shas` supplies the base
  commit.
- **Workflow lint**: actionlint (checksum-verified) and zizmor.
- **CI**: passes only if every other job succeeded or was skipped. It is the
  one check that [branch protection](#branch-protection) requires.

A weekly scheduled run, also startable by hand, runs every target on every
project and adds the **Dependency audit** job (`yarn npm audit` and
`uv audit`).

Every action is pinned to a full commit SHA with a version comment; zizmor
enforces the pins and Dependabot proposes updates. Before you change a
workflow, run both linters locally:

```sh
actionlint                                   # https://github.com/rhysd/actionlint
GH_TOKEN="$(gh auth token)" uvx zizmor@1.30.1 .github
```

## Branch Protection

The **Protect main** repository ruleset applies to the default branch with no
bypass list, so it binds repository admins too:

- Every change reaches `main` through a pull request; direct pushes are
  rejected. No approvals are required, so a sole maintainer can merge their own
  PRs.
- Squash is the only allowed merge method, and the repository settings disable
  merge commits and rebase merging. The squash commit takes the PR title as its
  subject, which is why PR titles follow Conventional Commits.
- A pull request merges only after the **CI** check from GitHub Actions
  passes. The branch need not be up to date with `main`, so another PR
  landing first doesn't force a rebase and rerun; the CI run on each push to
  `main` catches breakage after a merge.
- Force-pushes to `main` and deleting it are blocked.

Auto-merge is enabled, so `gh pr merge --auto --squash` merges a PR once
**CI** passes.

Inspect what GitHub enforces with
`gh api repos/Abildtoft/kramme-busy-bar-apps/rules/branches/main`.
