# BUSY Bar apps

An Nx monorepo for [BUSY Bar](https://busy.app/) apps in TypeScript and
Python. Each app is a small program on your computer or a server that draws on
the bar's displays through its HTTP API, using the official `busylib` client
for its language.

| Project                                                      | Language   | What it is                                          |
| ------------------------------------------------------------ | ---------- | --------------------------------------------------- |
| [`apps/clock`](apps/clock/README.md)                         | TypeScript | The time on the front display, the date on the back |
| [`apps/countdown`](apps/countdown/README.md)                 | Python     | Days and hours left until an event                  |
| [`apps/agent-fleet`](apps/agent-fleet/README.md)             | Python     | Claude sessions, Showtime, and review progress      |
| [`apps/claude-limits`](apps/claude-limits/README.md)         | Python     | Usage limits of every rotated Claude account        |
| [`apps/copenhagen-glance`](apps/copenhagen-glance/README.md) | TypeScript | Danish spot price, CO2, and rain                    |
| [`apps/event-day`](apps/event-day/README.md)                 | TypeScript | PhotoCraft booths and ChallengeCraft on event days  |
| [`apps/intercom`](apps/intercom/README.md)                   | TypeScript | Who on the team is free, and knocks, through Convex |
| [`apps/linear-queue`](apps/linear-queue/README.md)           | TypeScript | A Linear team's ready, active, and review queue     |
| [`apps/merge-ticker`](apps/merge-ticker/README.md)           | TypeScript | Today's merges, failing checks, auto-merge queue    |
| [`libs/bar-kit`](libs/bar-kit/README.md)                     | TypeScript | Connection settings, display helpers, frame loop    |
| [`libs/bar-kit-py`](libs/bar-kit-py/README.md)               | Python     | The same kit for Python apps                        |
| [`libs/json-values`](libs/json-values/README.md)             | TypeScript | Narrowing untrusted JSON from APIs, without casts   |
| [`tools/catalogue`](tools/catalogue/README.md)               | TypeScript | A landing page showing what every app draws         |
| [`tools/emulator`](tools/emulator/README.md)                 | TypeScript | A BUSY Bar in the browser, built from its firmware  |
| [`tools/workspace`](tools/workspace/README.md)               | TypeScript | Nx plugin for Python projects, project generator    |

## Prerequisites

- **Node.js 24**, the exact release pinned in `.node-version` and `.nvmrc`.
  The setup script below installs it with mise, fnm, or nvm. Node 24 ships
  Corepack, which provides the Yarn release `packageManager` pins.
- **uv** ([install guide](https://docs.astral.sh/uv/getting-started/installation/)),
  in the range `required-version` in the root `pyproject.toml` allows; uv
  refuses to run outside it. uv downloads Python 3.14 itself.
- **A BUSY Bar**, or the emulator. Plugged in over USB a bar answers at
  `10.0.4.20` with no setup. Wi-Fi and the cloud proxy need a token; see
  [Connect to a bar](#connect-to-a-bar). Without a bar, run
  `NX_DAEMON=false yarn nx run emulator:start` and set
  `BUSYBAR_ADDR=127.0.0.1:8080` ([tools/emulator](tools/emulator/README.md)).

## Install

```sh
bash scripts/setup-workspace.sh
```

It installs the pinned Node if your shell runs another version, then runs:

```sh
corepack enable
yarn install                            # Node packages and the Git hooks
uv sync --all-packages                  # Python 3.14 and the Python packages
node scripts/check-workspace-ready.mjs  # read-only check that everything is in place
```

Run the last line on its own whenever a tool fails in a way that looks
environmental; it needs only Node and prints a fix for each problem.

## Run an app

```sh
NX_DAEMON=false yarn nx run clock:start
COUNTDOWN_TARGET=2026-12-24T18:00:00+01:00 NX_DAEMON=false yarn nx run countdown:start
```

Press Ctrl+C to stop. The app clears what it drew before it exits.

To see every app at once, build the catalogue: a page with each app's
displays in its most telling states, and how it works.

```sh
NX_DAEMON=false yarn nx run catalogue:build  # writes dist/catalogue/index.html
```

### Connect to a bar

Without configuration, apps talk to a bar plugged in over USB. For Wi-Fi or
the cloud, copy `.env.example` to `.env.local` and set:

| Variable        | Wi-Fi                             | Cloud                   |
| --------------- | --------------------------------- | ----------------------- |
| `BUSYBAR_ADDR`  | The bar's IP address or host name | `https://api.busy.app`  |
| `BUSYBAR_TOKEN` | The HTTP access password, if set  | An API token (required) |

Nx loads `.env.local` into every task, so both languages pick it up.
[docs/busy-bar.md](docs/busy-bar.md) covers the displays, fonts, and API.

## Create an app or library

```sh
NX_DAEMON=false yarn nx g @busy-bar-apps/workspace:project weather --language=python
NX_DAEMON=false yarn nx g @busy-bar-apps/workspace:project weather-api --language=ts --type=lib
```

The generator creates a working project that already has its tags, lint, type
checking, tests, and README. It also links it into the Yarn or uv workspace.
New apps draw their own name, so `nx run <name>:start` works straight away.

## Verify

```sh
yarn verify:fast  # format, references, project check, lint, typecheck
yarn verify       # everything above plus Knip and tests; run before you push
```

Both check only the projects your branch affects. CI runs the same checks;
see [docs/command-reference.md](docs/command-reference.md).

## Layout

```text
apps/      Runnable BUSY Bar apps, one project per directory
libs/      Shared libraries
tools/     Workspace tooling: the emulator, the app catalogue, the Nx Python
           plugin, and the project generator
docs/      Guides and architecture decision records
scripts/   Repository scripts (verification, readiness, hooks)
```

Each project's language shows in its tags: `lang:ts` projects have a
`package.json`, `lang:python` projects a `pyproject.toml`.

## Documentation

Start at [docs/README.md](docs/README.md). Agents start at
[AGENTS.md](AGENTS.md).
