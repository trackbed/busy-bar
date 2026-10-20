# merge-ticker

A BUSY Bar app in TypeScript for your pull requests across every repository
your token can see. The front display shows today's merge count beside what
most needs you: failing checks first, then the auto-merge queue, then
everything open, with one cell per open pull request coloured by its checks.
A new merge takes over the display for 15 seconds with a sound, and newly
failing checks play a sound too. The back display lists the open pull
requests.

## Owns

- The GitHub query and its parsing ([src/github.ts](src/github.ts)): one
  GraphQL request a minute with two searches, your open pull requests (up to
  50, with checks and auto-merge) and the ones merged since local midnight.
- Noticing merges and newly failing checks ([src/watch.ts](src/watch.ts)).
- The layout ([src/render.ts](src/render.ts)).

## Does Not Own

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

| Variable                 | Default    | What it does                                        |
| ------------------------ | ---------- | --------------------------------------------------- |
| `GITHUB_TOKEN`           | (required) | A token that can read your pull requests and checks |
| `MERGE_TICKER_SCOPE`     | (none)     | Extra search qualifiers, such as `org:consensusaps` |
| `MERGE_TICKER_TIME_ZONE` | system     | IANA zone that decides when "today" starts          |
| `MERGE_TICKER_SOUND`     | `on`       | `off` silences merges and failures                  |

Keep the token out of `.env.example`; put it in the gitignored `.env.local` or
the shell.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p merge-ticker
```
