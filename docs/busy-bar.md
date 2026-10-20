# The BUSY Bar Platform

Status: Current. Facts checked on 2026-10-19 against
[docs.busy.app](https://docs.busy.app/bar/dev), `@busy-app/busy-lib` 0.21.1,
and `busylib` 2.6.0; input and sound checked against `busylib` 2.6.0 on
2026-10-20; drawing, priority, and animation rules checked against the
firmware source ([busy-app/busybar-firmware](https://github.com/busy-app/busybar-firmware)
at `a11df43`, API 27.14.0) on 2026-10-20.

A BUSY Bar app in this repository is a program on a computer or server that
draws on the bar through its HTTP API. Nothing is installed on the bar itself.
The official docs list a JavaScript SDK for on-device apps as "coming soon";
revisit this guide when it ships.

## Displays

| Display | Size                    | Colour            |
| ------- | ----------------------- | ----------------- |
| Front   | 72×16                   | RGB LEDs          |
| Back    | 160×80, of which 148×80 | 16 levels of grey |

- The back display's status bar keeps its rightmost 12 columns, so apps draw
  on 148×80 and anything past `x = 147` is cut off. `BACK_DISPLAY` in both
  kits is that 148×80 area.
- Coordinates start at the top-left corner. `align` picks which point of the
  element `x` and `y` place (`top_left`, `top_mid`, `center`, `bottom_right`,
  and so on), so `align: 'center'` at the display's midpoint centres text
  without measuring it.
- Elements outside the display are not drawn. A right-aligned element ends
  one column left of its `x`, but busylib warns about an element at
  `x = width`, so anchor right-aligned text at `x = width - 1` and accept a
  one-column margin.
- Colours are `#RRGGBBAA` strings. Both kits export `rgba()` to build them.

## Fonts

Text must be **printable ASCII**: the fonts are bitmaps without other glyphs.
A character a font lacks draws as an outlined box; all fonts but `tiny` and
`global` lack the backtick.

| Font                                                   | Line height (px) |
| ------------------------------------------------------ | ---------------- |
| `tiny`                                                 | 6                |
| `small`                                                | 9                |
| `normal`, `condensed`, `bold`, `global`, `superscript` | 11               |
| `large`                                                | 13               |
| `extra_large`                                          | 14               |

Two lines of text fit on the front display only with `tiny` plus `small`.

The fonts are proportional. Measure text before you rely on it fitting: the
kits' `textWidth` / `text_width` give its width in pixels, `fitText` /
`fit_text` cut it short with `..`, and `toBarText` / `to_bar_text` turn any
text, such as a PR title or a Danish place name, into printable ASCII.

## Drawing

One draw request sends an `application_name` and a list of elements, each with
an `id`. Element types are `text`, `image`, `animation`, `countdown`,
`rectangle`, and (TypeScript client) `xpmbitmap`. The bar groups elements by
`application_name`; the kits clear them by that name when an app stops.

**Draws merge.** A draw from the app on screen updates the elements it names,
by `id`, and leaves the others in place; a draw from another app replaces
everything. An element the app stops sending stays until it is deleted, so
the kits' frame loops delete the ids a frame no longer draws. A draw that
fails part-way (an `id` redrawn with another type or display, or more than
100 elements) still applies the elements before the failing one.

**Priority.** A draw has a priority from 1 to 100 (default 50). The app on
screen can redraw at or above its own priority; another app needs a higher
one. Built-in apps hold the screen at 10. While the BUSY timer is working,
resting, or paused, the bar holds it at 101: every draw is refused, even at
priority 100, and an app already on screen is closed. A refused draw waits up
to 1.5 seconds for the screen to free up, then fails with 409. Pressing BACK
or moving the mode switch also closes the app on screen; the kits' frame
loops draw it again on their next frame.

**Motion.** Text scrolls only when it is wider than its `width`:
`scroll_rate` is in pixels per minute, the delays in milliseconds. An
animation (`stock_path: 'shared/<name>.anim'`, see the emulator for the
names) plays its `section` once and holds the last frame unless `loop` is
set. Sending an element again restarts its scroll and its animation section,
and a one-shot animation that has finished does not play again until the
element is deleted or names another file. The kits' frame loops send every
element each frame, so an app with motion should keep its frame interval
long, and a looping animation stays smooth across frames with
`await_previous_end: true`, which queues the restart behind the current
loop.

Images and sounds are uploaded first (`assets/upload`) and then referenced by
path. The bar decodes an uploaded image only as a PNG whose name ends in
`.png`, and plays an uploaded sound as raw 16-bit mono PCM at 44.1 kHz from
its first byte, so a WAV header plays as a click. busylib's
`converter.convert_for_storage` resizes and re-encodes files for the bar; the
TypeScript client uploads bytes as they are.

## Sound

`audio_play(stock_path=..., application_name=...)` in Python and
`AudioPlay({ application_name, stock_path })` in TypeScript play a sound the
bar ships, with no upload. busylib lists three that ship with the firmware:
`shared/sounds/calendar_event_starts.snd`,
`shared/sounds/calendar_reminder_ends.snd`, and
`shared/sounds/volume_change.snd`.

## Input

The bar reports its three buttons (OK, BACK, START), the wheel, and the mode
selector (BUSY, CUSTOM, OFF, APPS, SETTINGS) on its status WebSocket,
`/api/status/ws`, as protobuf.

- busylib's `AsyncBusyBar.stream_status_ws()` decodes the stream, and
  `busylib.features.input_events(message)` turns each message into typed
  `ButtonEvent`, `EncoderEvent`, and `SelectorEvent` values.
- The TypeScript client's `StateStream` runs in browsers only, so an app that
  reads input is simplest in Python.
- The stream is local: the cloud refuses it, so input needs USB or Wi-Fi.
- Every listener gets every event, whichever app is on screen. The selector is
  reported only when it moves.

## Connecting

| Connection | Address                | Authentication                                                                |
| ---------- | ---------------------- | ----------------------------------------------------------------------------- |
| USB        | `10.0.4.20`            | None                                                                          |
| Wi-Fi      | The bar's IP address   | HTTP access password in `X-API-Token`, if one is set                          |
| Cloud      | `https://api.busy.app` | API token as a bearer token ([create one](https://cloud.busy.app/api-tokens)) |

Wi-Fi access to the API is off until you enable it in the bar's web interface
(open `http://10.0.4.20` over USB). Both kits read the same variables, which
Nx loads from `.env.local` (see `.env.example`):

- `BUSYBAR_ADDR`: IP address, host name, or URL. Unset means USB.
- `BUSYBAR_TOKEN`: the Wi-Fi password or the cloud token. The kits send it the
  way the connection expects; the cloud requires it.

Bars ship with firmware 1.0.2 (API 24.3.0), while `busylib` 2.6.0 targets API
27.5.0. Update the firmware in the web interface before chasing API errors.

## Emulator

[`tools/emulator`](../tools/emulator/README.md) is a BUSY Bar on your
computer, built from the open firmware: start it with
`NX_DAEMON=false yarn nx run emulator:start`, point an app at it with
`BUSYBAR_ADDR=127.0.0.1:8080`, and watch both displays, animations included,
at <http://127.0.0.1:8080>. It answers the same API with the same errors and
applies the canvas rules above, so check a new app there before a real bar.

## Client libraries

| Language   | Package              | Notes                                                                                                                           |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `@busy-app/busy-lib` | `BusyBar` wraps every endpoint as a PascalCase method (`DisplayDraw`). `StateStream` and `ScreenRenderer` run in browsers only. |
| Python     | `busylib`            | `BusyBar` and `AsyncBusyBar` with snake_case methods (`display_draw`); Pydantic models in `busylib.types`.                      |

Apps use them through the kits ([`bar-kit`](../libs/bar-kit/README.md),
[`bar-kit-py`](../libs/bar-kit-py/README.md)) and import element types
directly when they draw.

## References

- [Developer docs](https://docs.busy.app/bar/dev) and the
  [HTTP API overview](https://docs.busy.app/bar/dev/http-api).
- HTTP API reference: `http://10.0.4.20/docs` on the bar, or
  [api.busy.app/busybar/docs](https://api.busy.app/busybar/docs) for the cloud.
- [busylib for Python](https://busy-app.github.io/busylib-py/) and
  [busylib for TypeScript](https://github.com/busy-app/busylib-ts).
- The [firmware source](https://github.com/busy-app/busybar-firmware), which
  [`tools/emulator`](../tools/emulator/README.md) follows.
- Community (unofficial): an [app gallery](https://github.com/maxswinkels/busybar-apps).
