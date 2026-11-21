# bar-kit-py

Shared plumbing for Python BUSY Bar apps: the `bar-kit` distribution, imported
as `bar_kit`. The TypeScript counterpart is [`bar-kit`](../bar-kit/README.md);
both read the same environment variables and behave the same way.

## Owns

- Connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`
  (`load_bar_config`, which raises a `BarConfigError` for an address that is
  not a host name, IP address, or URL, or for the cloud without a token) and
  the async busylib client built from them (`create_busy_bar`).
- App settings from the environment: `env_switch` (`on` or `off`, on when
  unset), `env_whole_number` (decimal digits only, between a `minimum` and an
  optional `maximum`), and `env_http_url` (an absolute `http://` or
  `https://` URL whose host is a name of letters, digits, and hyphens, a
  dotted IPv4 address, or a bracketed IPv6 address, with an optional port up
  to 65535). Each raises a `SettingsError`
  naming the variable; apps' own settings errors extend it.
- Display sizes (`FRONT_DISPLAY`, and `BACK_DISPLAY`: the 148×80 of the
  back screen that the status bar leaves to apps) and colours (`rgba`).
- The render vocabulary every app draws with: `text_element` (keyword-only,
  an optional `align`), `solid_rectangle`, `status_cells` (one cell per
  colour along the front's bottom row), the shared `PALETTE` (`bright`,
  `text`, `dim`, `idle`, `good`, `warn`, `bad`, `info`), and the standard
  line positions `SUMMARY_Y` (front, under the headline) and `FOOTER_Y`
  (back, last line). The TypeScript kit gives the same elements and colours.
  For render tests, `elements_by_id` keys a frame by element ID, and
  `text_of` and `color_of` read one element from it (None when it is
  missing).
- The frame loop (`run_bar_app`): draw every interval at a `priority` from
  `MIN_PRIORITY` to `MAX_PRIORITY` (default `DEFAULT_PRIORITY`, 50), delete the elements a frame stops drawing
  (the bar keeps them otherwise), log failed draws and keep going, clear the
  display on shutdown. Setting `stop` cancels a draw or deletion in flight
  without logging it. `install_shutdown_handlers` sets `stop` on the first
  SIGINT or SIGTERM; a second one ends the process at once, without clearing
  the display, for when the bar does not answer. Failed element deletions
  are retried on later frames, including IDs drawn during failed cleanup.
  When BACK, the mode switch, or the BUSY timer has closed the canvas, the
  bar refuses a deletion that names an element it no longer has, so the loop
  then deletes the IDs one at a time and forgets the ones that are gone.
- Background data (`Poller`): fetch a source every `interval` seconds, try
  again after `retry` when it fails, and keep the latest value (`latest`) and
  the last failure (`failure`) for a pure render function. A failure's
  `error` is the `Exception` the fetch raised. Setting `stop` cancels a fetch
  in flight.
- The buttons, wheel, and mode selector (`listen_for_input`): read busylib's
  status stream, hand each `InputEvent` to a handler, reopen the stream after
  it drops, and log a handler that raises, until `stop` is set. The cloud
  does not stream input, so with a cloud `config` it warns once and returns.
  Every listener gets every event, whichever app is on screen, so
  `track_screen` wraps the client `run_bar_app` draws with and reports
  whether the app's frames reach the screen (`on_screen()`): true for 2.5
  seconds after a frame draws, false as soon as the bar refuses one.
- Alert sounds (`Speaker`): `play` a stock sound by busylib's name
  (`StockSound`: `event`, `reminder`, `volume`; paths in busylib's
  `STOCK_SOUNDS`, re-exported) under the app's name. `play` returns at once
  and never raises, so a slow or absent bar never holds up a poll; a failed
  sound is logged, and a speaker made with `enabled=False` stays silent.
  Sounds still playing are cancelled with the event loop at shutdown.
  `wait()` settles started sounds in tests. Each app keeps only its choice of
  which alert plays which sound.
- Text for the bitmap fonts: `to_bar_text` turns any text into printable ASCII
  the fonts draw (`Nørreport` becomes `Noerreport`, a backtick an
  apostrophe, any run of Unicode whitespace one space), `text_width` measures
  it in pixels and raises `ValueError` on anything else, `fit_text` cuts it
  to a width with `ELLIPSIS` (`..`), and `overflowing_text` finds the text
  elements that run past their display's edge, for layout tests. The widths
  are a copy of busy-lib's font maps; both kits test theirs against
  [bar-kit-text-widths.json](../../bar-kit-text-widths.json), and their text,
  width-refusal, and address cases against
  [bar-kit-contract.json](../../bar-kit-contract.json), so a change to one
  kit fails the other's tests until both agree.
- The app catalogue's contract (`Preview`, `PreviewScene`, `PreviewStep`):
  what an app's `preview` target prints with `print_preview`, as one line of
  JSON, elements serialized the way busylib sends them
  ([tools/catalogue](../../tools/catalogue/README.md)).
- Re-exports of busylib's element types (`TextElement`, `RectangleElement`,
  `DisplayElement`, `DisplayName`, `DisplayFontName`) and input events
  (`InputEvent`, `ButtonEvent`, `EncoderEvent`, `SelectorEvent`,
  `SelectorPosition`), so apps import only `bar_kit` and never depend on
  busylib without declaring it.

## Does Not Own

- What any app draws. That lives in the app's render function.
- The HTTP API itself: [busylib](https://busy-app.github.io/busylib-py/).

## Start Here

- [src/bar_kit/\_\_init\_\_.py](src/bar_kit/__init__.py): the public API.
- [src/bar_kit/run.py](src/bar_kit/run.py): the loop every app runs.

```python
import asyncio

from bar_kit import (
    DisplayName,
    create_busy_bar,
    install_shutdown_handlers,
    load_bar_config,
    run_bar_app,
    text_element,
)


async def main() -> None:
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    client = create_busy_bar(load_bar_config())
    async with client:  # not `as client`; see docs/python.md#busylib-gotchas
        await run_bar_app(
            name="my-app",
            client=client,
            render=lambda _now: [
                text_element(
                    element_id="hi",
                    text="HI",
                    display=DisplayName.FRONT,
                    font="normal",
                    x=0,
                    y=0,
                )
            ],
            interval=1.0,
            stop=stop,
        )
```

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p bar-kit-py
```
