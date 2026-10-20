# Emulate the Bar From Its Firmware Source

- Status: Accepted
- Date: 2026-10-20
- Area: tools/emulator and checking apps without hardware

## Context

Apps draw on the bar through its HTTP API, and how a draw looks depends on
firmware behaviour no client library documents: the bitmap fonts' metrics,
how `align` anchors an element, the status bar taking 12 columns of the back
display, priorities and the BUSY timer refusing every draw, draws merging by
element id, and when scrolling text and animations start over. The only
emulator was a community one that draws only the front display, plays every
sound as a beep, and does not play animations.

Flipper publishes the firmware as open source: code under GPL-2.0-or-later,
images, animations, and sounds under CC-BY-SA-4.0, and fonts under OFL-1.1.
Its pinned LVGL fork is MIT. The repository's own license must not change.

## Decision

- `tools/emulator` is a first-party TypeScript emulator that reimplements the
  firmware's behaviour, read from its source and LVGL's, without copying
  code. Module comments name the firmware file each one follows.
- The firmware's fonts and stock assets are downloaded at first start from a
  pinned commit and checked against their Git blob hashes. The repository
  records only paths and hashes
  ([firmware-assets.json](../../tools/emulator/src/assets/firmware-assets.json)),
  never the files.
- The emulator renders on the server, at the firmware's 16 ms refresh, so
  `/api/screen`, the status stream, and the page all show the same pixels.
  Front text is checked against the firmware's reference screenshots.

## Consequences

- Apps can be checked without a bar, and the emulator shows firmware behaviour
  the kits must handle: the kits' frame loops now delete elements a frame
  stops drawing, `BACK_DISPLAY` is the 148×80 apps can draw on, and
  `toBarText` drops the backtick most fonts lack.
- A firmware change can make the emulator wrong until someone re-reads the
  firmware and re-pins it. The emulator reports the pinned API version.
- The first start needs network access to GitHub (about 12 MB).
- Approximations stay listed in the [emulator README](../../tools/emulator/README.md#known-differences).

## Revisit

Revisit when Flipper ships an official emulator or simulator for the bar, or
when the firmware's API major version changes.
