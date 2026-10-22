# bar-kit-py

Shared plumbing for Python BUSY Bar apps: the `bar-kit` distribution, imported
as `bar_kit`. The TypeScript counterpart is [`bar-kit`](../bar-kit/README.md);
both read the same environment variables and behave the same way.

## Owns

- Connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`
  (`load_bar_config`) and the async busylib client built from them
  (`create_busy_bar`).
- Display sizes (`FRONT_DISPLAY`, and `BACK_DISPLAY`: the 148×80 of the
  back screen that the status bar leaves to apps) and colours (`rgba`).
- The frame loop (`run_bar_app`): draw every interval at a `priority`
  (default `DEFAULT_PRIORITY`, 50), delete the elements a frame stops drawing
  (the bar keeps them otherwise), log failed draws and keep going, clear the
  display on shutdown (`install_shutdown_handlers`). Failed element deletions
  are retried on later frames, including IDs drawn during failed cleanup.
- Background data (`Poller`): fetch a source every `interval` seconds, try
  again after `retry` when it fails, and keep the latest value (`latest`) and
  the last failure (`failure`) for a pure render function.
- Text for the bitmap fonts: `to_bar_text` turns any text into printable ASCII
  the fonts draw (`Nørreport` becomes `Noerreport`, a backtick an
  apostrophe), `text_width` measures it in pixels, and `fit_text` cuts it to
  a width with `..`. The widths come from busy-lib's font maps, so both kits
  measure alike.
- The app catalogue's contract (`Preview`, `PreviewScene`, `PreviewStep`):
  what an app's `preview` target prints with `print_preview`, as one line of
  JSON, elements serialized the way busylib sends them
  ([tools/catalogue](../../tools/catalogue/README.md)).

## Does Not Own

- What any app draws. That lives in the app's render function.
- The HTTP API itself: [busylib](https://busy-app.github.io/busylib-py/).

## Start Here

- [src/bar_kit/\_\_init\_\_.py](src/bar_kit/__init__.py): the public API.
- [src/bar_kit/run.py](src/bar_kit/run.py): the loop every app runs.

```python
import asyncio

from busylib import types

from bar_kit import (
    create_busy_bar,
    install_shutdown_handlers,
    load_bar_config,
    run_bar_app,
)


async def main() -> None:
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    client = create_busy_bar(load_bar_config())
    async with client:  # not `as client`; see docs/python.md#busylib-gotchas
        await run_bar_app(
            name="my-app",
            client=client,
            render=lambda _now: [types.TextElement(id="hi", text="HI", font="normal")],
            interval=1.0,
            stop=stop,
        )
```

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p bar-kit-py
```
