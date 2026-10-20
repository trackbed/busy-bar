# event-day

A BUSY Bar app in TypeScript for event days with Consensus Event Studio. The
front display shows how many PhotoCraft booths are live and how many portraits
their walls hold, with each booth in turn on the second line and one cell per
booth on the bottom row. A live booth whose wall has not moved for a while
turns amber as quiet. Without booths, a ChallengeCraft leaderboard takes the
front. The back display lists every booth and the challenge. A sound plays
when a live booth goes quiet, cannot be read, or disappears.

## Owns

- Reading PhotoCraft booths ([src/photocraft.ts](src/photocraft.ts)) through
  the public routes the live wall uses: a wall token from
  `POST /api/photo-craft-token`, then the newest portraits from
  `GET /api/photo-craft?boothId=`. No login is involved.
- Reading a ChallengeCraft leaderboard ([src/challenge.ts](src/challenge.ts))
  with the public `leaderboard:getLeaderboard` query and the TV leaderboard's
  token, through Convex's HTTP API.
- Deciding when a booth is quiet ([src/event.ts](src/event.ts)) and the layout
  ([src/render.ts](src/render.ts)).

## Does Not Own

- Event Studio. The app only reads what the wall and the TV leaderboard can
  read.
- Connection settings, the frame loop, polling, and shutdown handling. Those
  live in [`bar-kit`](../../libs/bar-kit/README.md).

## Start Here

What PhotoCraft can and cannot tell an outside reader, as of October 2026:

- **No heartbeat.** PhotoCraft does not report kiosk presence, so "quiet" is
  inferred from the wall: a live booth with no new portrait for
  `EVENT_DAY_QUIET_MINUTES`. A booth that has published nothing yet stays
  live.
- **Portraits, not captures.** The count is published portraits, up to 200 per
  booth (shown as `200+`).
- **Shared token budget.** Minting a wall token shares a rate limit with every
  kiosk, so the app keeps each booth's token for its 30-minute life, waits
  5 minutes after "not active" and 15 after "not found", and follows the rate
  limit's own wait. Reading the gallery has no limit.

A booth heartbeat would need an Event Studio change: a small presence table
written by the kiosk, read by a token-guarded status route.

This app has been tested against PhotoCraft's routes as the code describes
them, not yet against a live event.

## Run

```sh
EVENT_DAY_PHOTOCRAFT_URL=https://<photocraft-app> \
EVENT_DAY_BOOTHS=summit-2026/main-booth,summit-2026/side-booth \
  NX_DAEMON=false yarn nx run event-day:start
```

| Variable                    | Default | What it does                                                  |
| --------------------------- | ------- | ------------------------------------------------------------- |
| `EVENT_DAY_PHOTOCRAFT_URL`  | (none)  | The PhotoCraft app URL; required with booths                  |
| `EVENT_DAY_BOOTHS`          | (none)  | `event-slug/booth-slug`, comma separated                      |
| `EVENT_DAY_QUIET_MINUTES`   | `15`    | Wall silence after which a live booth counts as quiet         |
| `EVENT_DAY_CHALLENGE_URL`   | (none)  | The ChallengeCraft Convex URL (`https://<name>.convex.cloud`) |
| `EVENT_DAY_CHALLENGE_TOKEN` | (none)  | The `?token=` of the challenge's TV leaderboard URL           |
| `EVENT_DAY_PRIORITY`        | `50`    | Draw priority, 1 to 100; none draws over a running BUSY timer |
| `EVENT_DAY_SOUND`           | `on`    | `off` silences alerts                                         |

Set booths, a challenge, or both.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p event-day
```
