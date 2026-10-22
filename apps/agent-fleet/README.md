# agent-fleet

A BUSY Bar app in Python that shows every Claude Code session you run, fed by
Claude Code's HTTP hooks. The front display says how many sessions wait on
you, names the most urgent one, and draws one cell per session along the
bottom row. The back display lists every session: its workspace, what it is
doing (the skill it runs, when it runs one), and for how long.

## Owns

- The hook endpoint ([src/agent_fleet/server.py](src/agent_fleet/server.py)):
  a loopback HTTP server that answers every hook with an empty 200, so it
  never decides anything for an agent.
- Reading hook events and building the `hooks` block for
  `~/.claude/settings.json`
  ([src/agent_fleet/hooks.py](src/agent_fleet/hooks.py)).
- Session state ([src/agent_fleet/fleet.py](src/agent_fleet/fleet.py)), the
  layout ([src/agent_fleet/render.py](src/agent_fleet/render.py)), and the
  wheel, buttons, and chime
  ([src/agent_fleet/controls.py](src/agent_fleet/controls.py)).
- Sample frames for the app catalogue ([src/agent_fleet/preview.py](src/agent_fleet/preview.py)).

## Does Not Own

- Connection settings, the frame loop, and shutdown handling. Those live in
  [`bar-kit-py`](../../libs/bar-kit-py/README.md).
- Claude Code itself. The board only listens: it cannot answer prompts or
  steer agents.

## Start Here

`Fleet.apply(event, now)` turns each hook event into one of these statuses,
listed most urgent first:

| Status       | Colour | Meaning                                         | From                                              |
| ------------ | ------ | ----------------------------------------------- | ------------------------------------------------- |
| `asking`     | red    | Blocked on a permission prompt or a question    | `Notification`                                    |
| `failed`     | purple | The turn ended on an API error, such as a limit | `StopFailure`                                     |
| `done`       | amber  | The turn finished: your move                    | `Stop` with nothing pending                       |
| `working`    | green  | Prompt or tool activity                         | `UserPromptSubmit`, `PreToolUse`                  |
| `quiet`      | olive  | Working, but silent for a while                 | No event for `AGENT_FLEET_QUIET_MINUTES`          |
| `background` | blue   | Stopped, waiting for background work            | `Stop` with `background_tasks` or `session_crons` |
| `seen`       | grey   | Acknowledged on the bar                         | OK or BACK                                        |

A new `asking`, `failed`, or `done` plays a sound, at most one every five
seconds. Sessions are named after their Conductor workspace
(`~/conductor/workspaces/<repo>/<name>`), or their directory otherwise, and
disappear on `SessionEnd` or after eight hours without an event.

## Set Up

1. Print the hooks block and merge its entries into `~/.claude/settings.json`,
   next to any hooks you already have:

   ```sh
   uv run --package agent-fleet python -m agent_fleet --print-hooks
   ```

   Conductor runs Claude Code with your user settings, so every workspace
   reports in. A hook that cannot reach the board is a non-blocking error, so
   stopping the board never stalls an agent, and the 2-second timeout keeps a
   stuck one from slowing them down.

2. Start the board:

   ```sh
   NX_DAEMON=false yarn nx run agent-fleet:start
   ```

## Controls

- **Wheel**: move the highlight on the back display.
- **OK**: mark the highlighted session as seen.
- **BACK**: mark every session that waits on you as seen.
- **Selector** on BUSY, CUSTOM, or OFF: mutes the chime.

While the BUSY timer runs, rests, or is paused, the bar refuses every app's
draws, so the board stays out of the way until you are done. The wheel and buttons need a direct USB or Wi-Fi connection: the cloud
does not stream input. The bar reports input to every listener, so the wheel
also moves the highlight while another app is on screen.

## Run

| Variable                    | Default     | What it does                                                    |
| --------------------------- | ----------- | --------------------------------------------------------------- |
| `AGENT_FLEET_HOST`          | `127.0.0.1` | Interface the hook endpoint binds to                            |
| `AGENT_FLEET_PORT`          | `8740`      | Port the hooks post to; rerun `--print-hooks` after changing it |
| `AGENT_FLEET_SOUND`         | `on`        | `off` silences the chime                                        |
| `AGENT_FLEET_QUIET_MINUTES` | `15`        | Silence after which a working session looks stuck               |

Set `BUSYBAR_ADDR` and `BUSYBAR_TOKEN` for a bar that is not on USB.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p agent-fleet
```
