# clock

A BUSY Bar app in TypeScript: `HH:MM` on the front display above a bar that
fills over each minute, and the date on the back display.

## Owns

- The clock layout ([src/render-clock.ts](src/render-clock.ts)) and its
  one-second redraw ([src/main.ts](src/main.ts)).
- Sample frames for the app catalogue ([src/preview.ts](src/preview.ts)).

## Does Not Own

- Connection settings, the frame loop, and shutdown handling. Those live in
  [`bar-kit`](../../libs/bar-kit/README.md).

## Start Here

- `renderClock(now, timeZone)` maps a moment to three elements: the time in
  `extra_large` (14 px line height, rows 1–14), a 1 px seconds bar on row 15,
  and the date on the back display.

## Run

```sh
NX_DAEMON=false yarn nx run clock:start
```

Set `CLOCK_TIME_ZONE` (an IANA name such as `Europe/Copenhagen`) to override
the system time zone, and `BUSYBAR_ADDR`/`BUSYBAR_TOKEN` for a bar that is not
on USB.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p clock
```
