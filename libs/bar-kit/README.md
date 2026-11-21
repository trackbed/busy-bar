# bar-kit

Shared plumbing for TypeScript BUSY Bar apps, published in the workspace as
`@busy-bar-apps/bar-kit`. The Python counterpart is
[`bar-kit-py`](../bar-kit-py/README.md); both read the same environment
variables and behave the same way.

## Owns

- Connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`
  (`loadBarConfig`, which throws a `BarConfigError` for an address that is
  not a host name, IP address, or URL, or for the cloud without a token) and
  the busy-lib client built from them (`createBusyBar`).
- App settings from the environment: `envSwitch` (`on` or `off`, on when
  unset), `envWholeNumber` (decimal digits only, between a `min` and an
  optional `max`), and `envHttpUrl` (an absolute `http://` or `https://` URL
  whose host is a name of letters, digits, and hyphens, a dotted IPv4
  address, or a bracketed IPv6 address, with an optional port up to 65535). Each throws a `SettingsError` naming the
  variable; apps' own settings errors extend it.
- Display sizes (`FRONT_DISPLAY`, and `BACK_DISPLAY`: the 148×80 of the
  back screen that the status bar leaves to apps) and colours (`rgba`).
- The render vocabulary every app draws with: `textElement` (named `x` and
  `y`, an optional `align`), `solidRectangle`, `statusCells` (one cell per
  colour along the front's bottom row), the shared `PALETTE` (`bright`,
  `text`, `dim`, `idle`, `good`, `warn`, `bad`, `info`), and the standard
  line positions `SUMMARY_Y` (front, under the headline) and `FOOTER_Y`
  (back, last line). The Python kit gives the same elements and colours.
  For render tests, `elementsById` keys a frame by element ID, and `textOf`
  and `colorOf` read one element from it (undefined when it is missing).
- The frame loop (`runBarApp`): draw every interval at a `priority` from
  `MIN_PRIORITY` to `MAX_PRIORITY` (default `DEFAULT_PRIORITY`, 50), delete the elements a frame stops drawing
  (the bar keeps them otherwise), log failed draws and keep going, clear the
  display on shutdown. Stopping aborts a draw or deletion in flight without
  logging it. `shutdownSignal` aborts on the first SIGINT or SIGTERM; a second
  one ends the process at once, without clearing the display, for when the
  bar does not answer. Failed element deletions are retried
  on later frames, including IDs drawn while an earlier cleanup was failing.
  When BACK, the mode switch, or the BUSY timer has closed the canvas, the
  bar refuses a deletion that names an element it no longer has, so the loop
  then deletes the IDs one at a time and forgets the ones that are gone.
- Background data (`createPoller`): fetch a source every `intervalMs`, try
  again after `retryMs` when it fails, and keep the latest value (`latest()`)
  and the last failure (`failure()`) for a pure render function. A failure's
  `error` is always an `Error`: anything else a fetch throws arrives wrapped
  in one, as its `cause`.
- How fresh that data is, for a footer (`freshnessLine`): `updated 5m ago`,
  or `<source> unreachable, showing old data` once the source has failed and
  the latest value is older than the app's limit. `formatAge` is its age
  format: `now`, whole minutes, then whole hours.
- The buttons, wheel, and mode selector (`listenForInput`): read the bar's
  status stream over Node's WebSocket, hand each `InputEvent` to a handler,
  reopen the stream after it drops, and log a handler that throws. The cloud
  does not stream input, so there it warns once and returns. Every listener
  gets every event, whichever app is on screen, so `trackScreen` wraps the
  client `runBarApp` draws with and reports whether the app's frames reach the
  screen (`onScreen()`): true for 2.5 seconds after a frame draws, false as
  soon as the bar refuses one.
- Alert sounds (`createSpeaker`): `play` a stock sound by busylib's name
  (`StockSound`: `event`, `reminder`, `volume`; paths in `STOCK_SOUNDS`)
  under the app's name. `play` returns at once and never throws, so a slow or
  absent bar never holds up a poll; a failed sound is logged, a speaker made
  with `enabled: false` stays silent, and a `signal` cancels sounds still in
  flight at shutdown. `wait()` settles started sounds in tests. Each app keeps
  only its choice of which alert plays which sound.
- No clock helper: apps default their clock to `() => new Date()`, where
  Python apps use the Python kit's `utc_now`.
- Text for the bitmap fonts: `toBarText` turns any text into printable ASCII
  the fonts draw (`Nørreport` becomes `Noerreport`, a backtick an
  apostrophe, any run of Unicode whitespace one space), `textWidth` measures
  it in pixels from busy-lib's font maps and throws a `RangeError` on
  anything else, `fitText` cuts it to a width with `ELLIPSIS` (`..`), and
  `overflowingText` finds the text elements that run past their display's
  edge, for layout tests. Both kits test their widths against
  [bar-kit-text-widths.json](../../bar-kit-text-widths.json), and their text,
  width-refusal, and address cases against
  [bar-kit-contract.json](../../bar-kit-contract.json), so they agree.
- The app catalogue's contract (`Preview`, `PreviewScene`, `PreviewStep`):
  what an app's `preview` target prints with `printPreview`, as one line of
  JSON ([tools/catalogue](../../tools/catalogue/README.md)).
- Re-exports of busy-lib's element types (`TextElement`, `RectangleElement`,
  and others) and of `BusySnapshot`, what `BusySnapshotGet` answers about the
  BUSY timer, so apps need only this package.

## Does Not Own

- What any app draws. That lives in the app's render function.
- The HTTP API itself: [busy-lib](https://github.com/busy-app/busylib-ts).

## Start Here

- [src/index.ts](src/index.ts): the public API.
- [src/run-bar-app.ts](src/run-bar-app.ts): the loop every app runs.

```ts
import {
  createBusyBar,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
  textElement,
} from '@busy-bar-apps/bar-kit';

await runBarApp({
  name: 'my-app',
  client: createBusyBar(loadBarConfig()),
  render: () => [
    textElement({
      id: 'hi',
      text: 'HI',
      display: 'front',
      font: 'normal',
      x: 2,
      y: 2,
    }),
  ],
  intervalMs: 1000,
  signal: shutdownSignal(),
});
```

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p bar-kit
```
