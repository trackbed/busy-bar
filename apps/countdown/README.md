# countdown

A BUSY Bar app in Python: the time left until an event on the front display
(`66d 05h`, then `04:33:20` on the last day, then `NOW`), and what it counts
down to on the back display.

## Owns

- Reading the event from the environment
  ([src/countdown/settings.py](src/countdown/settings.py)).
- The countdown layout ([src/countdown/render.py](src/countdown/render.py)).
- Sample frames for the app catalogue ([src/countdown/preview.py](src/countdown/preview.py)).

## Does Not Own

- Connection settings, the frame loop, and shutdown handling. Those live in
  [`bar-kit-py`](../../libs/bar-kit-py/README.md).

## Start Here

- `render_countdown(now, settings)` maps a moment to three text elements.
- `load_settings(env)` validates `COUNTDOWN_TARGET` and `COUNTDOWN_LABEL`.

## Run

```sh
COUNTDOWN_TARGET=2026-12-24T18:00:00+01:00 COUNTDOWN_LABEL=XMAS \
  NX_DAEMON=false yarn nx run countdown:start
```

`COUNTDOWN_TARGET` is an ISO 8601 date and time with a UTC offset.
`COUNTDOWN_LABEL` defaults to `COUNTDOWN` and must be printable ASCII. Both can
live in `.env.local`.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p countdown
```
