# The BUSY Bar Platform

Status: Current. Facts checked on 2026-10-19 against
[docs.busy.app](https://docs.busy.app/bar/dev), `@busy-app/busy-lib` 0.21.1,
and `busylib` 2.6.0.

A BUSY Bar app in this repository is a program on a computer or server that
draws on the bar through its HTTP API. Nothing is installed on the bar itself.
The official docs list a JavaScript SDK for on-device apps as "coming soon";
revisit this guide when it ships.

## Displays

| Display | Size   | Colour            |
| ------- | ------ | ----------------- |
| Front   | 72×16  | RGB LEDs          |
| Back    | 160×80 | 16 levels of grey |

- Coordinates start at the top-left corner. `align` picks which point of the
  element `x` and `y` place (`top_left`, `top_mid`, `center`, `bottom_right`,
  and so on), so `align: 'center'` at the display's midpoint centres text
  without measuring it.
- Elements outside the display are not drawn.
- Colours are `#RRGGBBAA` strings. Both kits export `rgba()` to build them.

## Fonts

Text must be **printable ASCII**: the fonts are bitmaps without other glyphs.

| Font                                                   | Line height (px) |
| ------------------------------------------------------ | ---------------- |
| `tiny`                                                 | 6                |
| `small`                                                | 9                |
| `normal`, `condensed`, `bold`, `global`, `superscript` | 11               |
| `large`                                                | 13               |
| `extra_large`                                          | 14               |

Two lines of text fit on the front display only with `tiny` plus `small`.

## Drawing

One draw request sends an `application_name` and a list of elements, each with
an `id`. Element types are `text`, `image`, `animation`, `countdown`,
`rectangle`, and (TypeScript client) `xpmbitmap`. The bar groups elements by
`application_name`; the kits clear them by that name when an app stops.

**Priority.** A draw has a priority from 1 to 100 (default 50) and is accepted
only when it is at least the priority of the app on screen. Built-in apps run
at 10 and an active BUSY or CUSTOM work session at 90, so a default draw is
refused during a work session. Pass `priority` to the kit's frame loop
(`runBarApp` or `run_bar_app`) for content that must show then.

Images and sounds are uploaded first (`assets/upload`) and then referenced by
path. busylib's `converter.convert_for_storage` resizes and re-encodes them for
the bar; the TypeScript client uploads bytes as they are.

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
- Community (unofficial): an [app gallery](https://github.com/maxswinkels/busybar-apps)
  with a local emulator for testing without hardware.
