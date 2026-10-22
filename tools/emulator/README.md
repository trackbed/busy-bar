# emulator

A BUSY Bar on your computer: it answers the bar's HTTP API on
`127.0.0.1:8080` and shows both displays, animations included, in a browser
page. Apps run against it unchanged.

```sh
NX_DAEMON=false yarn nx run emulator:start
BUSYBAR_ADDR=127.0.0.1:8080 NX_DAEMON=false yarn nx run clock:start
```

Then open <http://127.0.0.1:8080>. `EMULATOR_HOST` and `EMULATOR_PORT` change
where it listens.

It is built from the bar's open firmware
([busy-app/busybar-firmware](https://github.com/busy-app/busybar-firmware)),
pinned in [src/assets/firmware-assets.json](src/assets/firmware-assets.json).
The first start downloads the firmware's fonts, stock images, animations, and
sounds (about 12 MB) into `${XDG_CACHE_HOME:-~/.cache}/busy-bar-apps/emulator`
and checks each against its Git hash; later starts work offline. Those files
are CC-BY-SA-4.0 and OFL-1.1 licensed, so the repository records only their
paths and hashes. The firmware's code is GPL; the emulator reimplements its
behaviour and copies none of it.

## Owns

- The HTTP API at firmware API 27.14.0 ([src/server/api.ts](src/server/api.ts)):
  the same paths, status codes, and error messages, including the draw
  parser's leniency ([src/device/elements.ts](src/device/elements.ts)).
- The canvas rules ([src/device/screen.ts](src/device/screen.ts)): priorities,
  the 1.5 s hold before a 409, merging draws by element id, timeouts, and the
  BUSY timer blocking every draw.
- Drawing ([src/render/](src/render/)): LVGL's text layout and blending, the
  firmware's anchors, scrolling, countdowns, rectangles, images, XPM bitmaps,
  the back display's 16 grey levels and status bar, and the "ACTIVE" card the
  back shows while an app draws only on the front. Front text matches the
  firmware's reference screenshots byte for byte.
- Animation playback ([src/device/animation-player.ts](src/device/animation-player.ts)):
  frame timing on the GUI's 8 ms tick, sections, looping, and
  `await_previous_end`, from stock animations and uploaded `.anim` files.
- The status WebSocket (`/api/status/ws`): input events, front frames, and
  heartbeats as protobuf, for busylib's input readers.
- A small public API for tools ([src/index.ts](src/index.ts)):
  `openFirmwareAssets` syncs and opens the pinned assets, and
  `screenshotDraw` validates one draw request as the API does and returns
  PNGs of both displays. The [app catalogue](../catalogue/README.md) uses it.
- The page ([src/web/](src/web/)): the displays, the buttons, wheel, and mode
  switch (they go through `/api/input`), a BUSY timer switch, sound, and the
  LED blink. Screenshots: `/emulator/screenshot.png?display=front|back&scale=8`.

## Does Not Own

- How apps connect: the kits read `BUSYBAR_ADDR` ([docs/busy-bar.md](../../docs/busy-bar.md#connecting)).
- The bar's built-in apps, menus, Wi-Fi, BLE, Matter, updates, and the cloud.
  While no app draws, the displays stay dark.

## Known Differences

- Rounded corners are anti-aliased by sampling, close to but not exactly
  LVGL's radius mask. The "ACTIVE" card places its parts at fixed positions
  rather than through LVGL's flex layout.
- Stock images come from the firmware's PNG sources; the firmware's build
  converts them to indexed `.image` files, which can shift colours slightly.
  Stock sounds play from their WAV sources, before the firmware's loudness
  normalisation and EQ.
- The firmware's own back-display reference screenshot sits one pixel higher
  than the layout rules predict, and the emulator follows the rules.
- `DELETE /api/audio/play` answers at once; the bar waits for the sound to
  fade out.

## Start Here

- A firmware update: `NX_DAEMON=false yarn nx run emulator:pin-firmware -- <commit sha>`
  rewrites the manifest; check the API version in
  [src/server/api.ts](src/server/api.ts) and the behaviour notes in the
  module comments against the new firmware.
- Behaviour questions: each module's opening comment names the firmware file
  it follows.

## Verify

The page tests load the real HTML and app in Happy DOM and record canvas,
HTTP, audio, and event-stream output. They check display conversion, state
validation, connection updates, controls, and sound without firmware downloads
or hardware. `tsconfig.web.spec.json` supplies DOM types for browser tests;
`tsconfig.spec.json` checks server tests. Browser source is included in the
normal coverage gate. Check the visual layout in a browser and on the bar as
described in
[the testing strategy](../../docs/testing-strategy.md).

```sh
NX_DAEMON=false yarn nx run-many -t lint oxlint typecheck test -p emulator
```
