# intercom

A BUSY Bar app in TypeScript that shows each bar who else on the team is
free, lets one bar knock on another, and starts a focus session for the
whole team at once. Every bar reads its own BUSY timer
and reports it to one Convex deployment, and every bar subscribes to the
whole team. The front display says how many teammates are free and who, with
one cell per teammate along the bottom. The back display lists every
teammate with what their timer says and the minutes it has left. Turn the
wheel to a free teammate and press OK to knock; their bar chimes and shows
the knock until they answer with OK (coming) or BACK (later). The last row,
"Focus together", starts every free teammate's BUSY timer at the same moment,
so the whole team works, and stops, together.

## Owns

- The Convex backend ([src/convex/](src/convex/)): the bars on the team and
  their keys ([bars.ts](src/convex/bars.ts), [keys.ts](src/convex/keys.ts)),
  presence and heartbeats ([presence.ts](src/convex/presence.ts)), knocks
  ([knocks.ts](src/convex/knocks.ts)), team focus sessions
  ([focus.ts](src/convex/focus.ts)), and the board every bar subscribes to
  ([team.ts](src/convex/team.ts)). `src/convex/_generated/` is written by
  `convex dev`; commit it.
- Reading the BUSY timer ([src/timer.ts](src/timer.ts)): the bar records a
  snapshot only when its timer changes state, so time left counts from the
  snapshot, and a timer that ran out still reports the snapshot that started
  it.
- Reporting on change, plus a heartbeat, and leaving the team as the app
  stops ([src/reporter.ts](src/reporter.ts)).
- What the wheel and buttons do ([src/controls.ts](src/controls.ts)), when
  the app counts as on screen ([src/screen.ts](src/screen.ts)), the sounds
  ([src/chime.ts](src/chime.ts)), and starting this bar's timer for a team
  focus ([src/focus.ts](src/focus.ts)).
- Reading the board and keeping the latest one the subscription delivered
  ([src/board.ts](src/board.ts)), the layout
  ([src/render.ts](src/render.ts)), and sample frames for the app catalogue
  ([src/preview.ts](src/preview.ts)).

## Does Not Own

- Connection settings, the frame loop, polling, reading the bar's buttons
  and wheel, and shutdown handling. Those live in
  [`bar-kit`](../../libs/bar-kit/README.md).
- The BUSY timer itself. The bar runs it, and while it works, rests, or is
  paused, the bar refuses every app's draws, so a busy bar shows its timer
  rather than the team, and takes no knocks.
- Why Convex, and why this shape: [ADR 0005](../../docs/adr/0005-convex-between-bars.md).

## Start Here

| Status    | Front colour | From the bar's BUSY timer                         |
| --------- | ------------ | ------------------------------------------------- |
| `FREE`    | green        | No timer, or one that ran out                     |
| `BUSY`    | red          | A running timer, with minutes left when it ends   |
| `REST`    | blue         | The break between two intervals                   |
| `PAUSED`  | amber        | A paused timer, or one waiting at a new interval  |
| `OFFLINE` | grey         | No report for 2.5 minutes, or the app was stopped |

Each bar reports when its status changes and at least once a minute
(`bars:report`). A heartbeat rewrites only the `heartbeats` table, which no
subscription reads, so it costs the other bars nothing. A running timer is
reported once, as the time it ends, and every bar counts down on its own
clock.

| Control | On the board                                                                         | While a knock waits | While a team focus counts down                     |
| ------- | ------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------- |
| Wheel   | Moves the highlight (`>`) over the teammates and the focus row                       | Nothing             | Nothing                                            |
| OK      | Knocks on a free teammate; on the focus row, starts a team focus or joins the one on | Answers "coming"    | Nothing                                            |
| BACK    | Nothing                                                                              | Answers "later"     | Skips it; on the bar that started it, calls it off |

- A knock reaches only a free, online bar (`knocks:send` checks), and waits
  2 minutes for an answer. The answer, or "did not answer", shows in the
  knocking bar's header for a minute. A bar has one knock out at a time: a
  new one replaces it.
- A team focus lasts `INTERCOM_FOCUS_MINUTES` (25 by default) of the bar
  that starts it, and starts 15 seconds later, so every bar can skip it.
  When it starts, each bar that did not skip it, and runs no timer of its
  own, starts its BUSY timer from a snapshot stamped with that moment, so
  they all end together ([src/focus.ts](src/focus.ts)). A bar that comes
  online up to half a minute after the start still joins by itself; one that
  skipped it, or comes later, can join with OK on the focus row. One team
  focus runs at a time.
- A new knock, an answer, and a team focus starting each chime once, unless
  `INTERCOM_SOUND=off`.
- The bar reports input to every listener, whichever app is on screen, so
  presses count only while the app's last frame reached the screen: never
  during the BUSY timer or under an app of higher priority. BACK also closes
  the app on screen, as on any app; the next frame draws it again.

## Set Up the Team

One person owns the deployment, on [Convex](https://www.convex.dev/) cloud:

1. Create the project and push the functions. The first run asks whether to
   log in: log in for a cloud project. It writes the dev deployment to
   `apps/intercom/.env.local`:

   ```sh
   NX_DAEMON=false yarn nx run intercom:backend   # leave running while you change functions
   NX_DAEMON=false yarn nx run intercom:deploy    # push to production for the team
   ```

   `deploy` runs `intercom:typecheck` first. Both targets pass
   `--typecheck disable` to the Convex CLI: its own check needs a
   `tsconfig.json` inside `src/convex/` and a `typescript` package that
   provides `tsc`, and this workspace has neither. `intercom:typecheck`
   checks `src/convex/` with the workspace's TypeScript 7 instead.

2. Add a bar for each teammate, and send each their key and the production
   URL (`https://<name>.convex.cloud`, in the Convex dashboard). Bar names are
   1 to 12 printable ASCII characters:

   ```sh
   NX_DAEMON=false yarn nx run intercom:convex -- run bars:add '{"name": "Anna"}' --prod
   NX_DAEMON=false yarn nx run intercom:convex -- run bars:remove '{"name": "Anna"}' --prod
   ```

   The key is shown only once. Convex stores its hash; to replace a lost key,
   remove the bar and add it again.

## Run

Each teammate runs the app next to their bar, over USB or Wi-Fi: the bar
streams its buttons only on a direct connection. The app reads the BUSY
timer from `GET /api/busy/snapshot`, so the bar needs firmware with that
endpoint. Put these in `.env.local`:

| Variable                 | What it is                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `INTERCOM_CONVEX_URL`    | The team's deployment, `https://<name>.convex.cloud`                  |
| `INTERCOM_KEY`           | The key `bars:add` answered for this bar; keep it secret              |
| `INTERCOM_SOUND`         | `on` (the default) or `off`, for the knock and answer chimes          |
| `INTERCOM_FOCUS_MINUTES` | How long a team focus this bar starts lasts: 5 to 1440, 25 by default |
| `BUSYBAR_ADDR`           | The bar, when not on USB ([docs/busy-bar.md](../../docs/busy-bar.md)) |

```sh
NX_DAEMON=false yarn nx run intercom:start
```

The URL is not `CONVEX_URL`: `convex dev` writes that one, for its own dev
deployment, into `apps/intercom/.env.local`.

## Try It Without Bars

A local Convex deployment needs no account: in a shell that cannot prompt, or
when you pick it at the first `convex dev`, the CLI runs Convex's open-source
backend on `127.0.0.1:3210`. It downloads the backend the first time. Run two
emulators and one app per emulator. Nx shares a running task between
processes, so start the second emulator and the second bar with `node`:

```sh
NX_DAEMON=false yarn nx run intercom:backend
NX_DAEMON=false yarn nx run intercom:convex -- run bars:add '{"name": "Anna"}'   # and Ben
EMULATOR_PORT=8090 NX_DAEMON=false yarn nx run emulator:start
(cd tools/emulator && EMULATOR_PORT=8091 node --disable-warning=ExperimentalWarning src/main.ts)
BUSYBAR_ADDR=127.0.0.1:8090 INTERCOM_CONVEX_URL=http://127.0.0.1:3210 INTERCOM_KEY=<Anna> NX_DAEMON=false yarn nx run intercom:start
(cd apps/intercom && BUSYBAR_ADDR=127.0.0.1:8091 INTERCOM_CONVEX_URL=http://127.0.0.1:3210 INTERCOM_KEY=<Ben> node src/main.ts)
```

Press the wheel and buttons on an emulator page, or send them:
`curl -X POST "http://127.0.0.1:8090/api/input?key=ok"` (also `up`, `down`,
and `back`). The BUSY switch on the page starts an infinite timer. For a
countdown, send the emulator a snapshot:

```sh
curl -X PUT http://127.0.0.1:8091/api/busy/snapshot -d "{\"snapshot\": {\"type\": \"SIMPLE\", \"card_id\": \"00000000-0000-0000-0000-000000000000\", \"is_paused\": false, \"time_left_ms\": 1500000}, \"snapshot_timestamp_ms\": $(date +%s000)}"
```

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p intercom
```

The Convex functions are tested against `convex-test`'s in-memory backend
([src/convex/bars.test.ts](src/convex/bars.test.ts),
[src/convex/knocks.test.ts](src/convex/knocks.test.ts),
[src/convex/focus.test.ts](src/convex/focus.test.ts)).
