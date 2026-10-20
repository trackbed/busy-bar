# claude-limits

A BUSY Bar app in Python for the Claude accounts
[conductor-claude-rotation](https://github.com/Abildtoft/conductor-claude-rotation)
rotates through. The front display shows the active account's five-hour usage
and when it resets, beside a pair of bars per account: the five-hour window
over the weekly one. The back display lists every account with both windows
and their resets. A sound plays when the tool switches accounts, and when every
account reaches its limit.

## Owns

- Reading the rotation tool's files
  ([src/claude_limits/rotation.py](src/claude_limits/rotation.py)).
- Judging each account the way the tool does
  ([src/claude_limits/board.py](src/claude_limits/board.py)): its threshold,
  stale readings, reset windows, and blocked accounts.
- The layout ([src/claude_limits/render.py](src/claude_limits/render.py)).

## Does Not Own

- Rotating accounts or collecting usage. The tool's monitor does both and
  writes the snapshots this board reads.
- Credentials. The board never touches the Keychain or calls the usage
  endpoint: refreshing the tool's tokens from outside breaks its logins.
- Connection settings, the frame loop, and shutdown handling. Those live in
  [`bar-kit-py`](../../libs/bar-kit-py/README.md).

## Start Here

- `read_rotation(root)` reads, every 30 seconds and without locking (the tool
  writes each file atomically):
  - `config.json`: the accounts, `threshold`, and `max_usage_age_seconds`.
  - `state/state.json`: `current_account` and any rotation in flight.
  - `state/usage/<account>.json`: the five-hour and weekly windows.
  - `logs/monitor.log`: the latest tick's status.
- `board_at(rotation, now)` grades each window: green below 80% of the
  threshold, amber from 80%, red at the threshold, and grey without a reading,
  past its reset, or older than `max_usage_age_seconds`.

## Run

Set up conductor-claude-rotation first, with `auto_collect_usage` on so its
monitor records usage. Then:

```sh
NX_DAEMON=false yarn nx run claude-limits:start
```

| Variable              | Default                                    | What it does          |
| --------------------- | ------------------------------------------ | --------------------- |
| `CLAUDE_LIMITS_DIR`   | `~/.local/share/conductor-claude-rotation` | The tool's data root  |
| `CLAUDE_LIMITS_SOUND` | `on`                                       | `off` silences alerts |

The board runs as your macOS user: the tool's files are readable by their
owner only. Without a `config.json` it says the tool is not set up.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p claude-limits
```
