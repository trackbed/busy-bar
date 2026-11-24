# merge-ticker

A BUSY Bar app in TypeScript for your pull requests across every repository
your token can see. The front display shows today's merge count beside what
most needs you: failing checks first, then the auto-merge queue, then
everything open, with one cell per open pull request coloured by its checks.
A new merge takes over the display for 15 seconds with a sound, and newly
failing checks play a sound too. The back display lists the open pull
requests.

## Incoming Trackbed review requests

Set `TRACKBED_BUSY_BAR_DIR` in the Trackbed environment and run
`trackbed:pr:review-queue`. Point merge-ticker at the resulting file:

```sh
MERGE_TICKER_INCOMING="$HOME/.local/state/trackbed/bar/incoming-trackbed+skills.json" NX_DAEMON=false yarn nx run merge-ticker:start
```

Use `incoming-all.json` for a queue produced with `--all-repos`. This view
reads the local snapshot every five seconds and runs without a GitHub token.
The front shows the total request count beside the number ready. On the
back, ready PRs have a highlighted label and appear first, oldest wait
first. Each wait has a bar scaled to the longest wait in the whole queue.
Drafts, blocked requests, and requests with cautions are labeled.
A tilde marks a wait estimated from when the PR opened. Long lists page every
eight seconds. The footer shows the observation age. A successful empty queue
shows CLEAR and an observation aged 15 minutes shows STALE. Rerun the skill
to refresh it. See the [snapshot contract](../../docs/adr/0006-trackbed-snapshots.md).

## Owns

- The GitHub query and its parsing ([src/github.ts](src/github.ts)): one
  GraphQL request a minute with two searches, your open pull requests (up to
  50, with checks and auto-merge) and the ones merged since local midnight.
- Each poll ([src/watch.ts](src/watch.ts)): noticing merges and newly
  failing checks, and the sound that announces them.
- The layout ([src/render.ts](src/render.ts)).
- The incoming review view: reading and ordering the Trackbed snapshot
  ([src/incoming.ts](src/incoming.ts)) and its layout
  ([src/render-incoming.ts](src/render-incoming.ts)).
- Sample frames for the app catalogue ([src/preview.ts](src/preview.ts)).

## Does Not Own

- Primitive JSON validation: [`json-values`](../../libs/json-values/README.md).
- Merging. GitHub's auto-merge does that; the ticker only watches.
- Connection settings, the frame loop, polling, and shutdown handling. Those
  live in [`bar-kit`](../../libs/bar-kit/README.md).

## Start Here

- `render(now, latest, failure)` picks the front's focus: failing, then
  queued, then open. Pull requests are tagged `FAIL`, `auto`, `draft`,
  `wait`, `ok`, or `-` behind.
- `MergeWatch.observe` takes the first reading as its baseline, so starting
  the app does not celebrate the day's merges.

## Run

```sh
GITHUB_TOKEN=$(gh auth token) NX_DAEMON=false yarn nx run merge-ticker:start
```

| Variable                 | Default    | What it does                                                  |
| ------------------------ | ---------- | ------------------------------------------------------------- |
| `GITHUB_TOKEN`           | (required) | A token that can read your pull requests and checks           |
| `MERGE_TICKER_SCOPE`     | (none)     | Extra search qualifiers, such as `org:consensusaps`           |
| `MERGE_TICKER_TIME_ZONE` | system     | IANA zone that decides when "today" starts                    |
| `MERGE_TICKER_SOUND`     | `on`       | `off` silences merges and failures                            |
| `MERGE_TICKER_INCOMING`  | (none)     | A Trackbed incoming snapshot; shows it instead, with no token |

Keep the token out of `.env.example`; put it in the gitignored `.env.local` or
the shell.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p merge-ticker
```
