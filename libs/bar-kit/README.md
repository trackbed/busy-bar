# bar-kit

Shared plumbing for TypeScript BUSY Bar apps, published in the workspace as
`@busy-bar-apps/bar-kit`. The Python counterpart is
[`bar-kit-py`](../bar-kit-py/README.md); both read the same environment
variables and behave the same way.

## Owns

- Connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`
  (`loadBarConfig`) and the busy-lib client built from them (`createBusyBar`).
- Display sizes (`FRONT_DISPLAY`, and `BACK_DISPLAY`: the 148×80 of the
  back screen that the status bar leaves to apps) and colours (`rgba`).
- The frame loop (`runBarApp`): draw every interval at a `priority`
  (default `DEFAULT_PRIORITY`, 50), delete the elements a frame stops drawing
  (the bar keeps them otherwise), log failed draws and keep going, clear the
  display on shutdown (`shutdownSignal`). Failed element deletions are retried
  on later frames, including IDs drawn while an earlier cleanup was failing.
  When BACK, the mode switch, or the BUSY timer has closed the canvas, the
  bar refuses a deletion that names an element it no longer has, so the loop
  then deletes the IDs one at a time and forgets the ones that are gone.
- Background data (`createPoller`): fetch a source every `intervalMs`, try
  again after `retryMs` when it fails, and keep the latest value (`latest()`)
  and the last failure (`failure()`) for a pure render function.
- The buttons, wheel, and mode selector (`listenForInput`): read the bar's
  status stream over Node's WebSocket, hand each `InputEvent` to a handler,
  reopen the stream after it drops, and log a handler that throws. The cloud
  does not stream input, so there it warns once and returns.
- Text for the bitmap fonts: `toBarText` turns any text into printable ASCII
  the fonts draw (`Nørreport` becomes `Noerreport`, a backtick an
  apostrophe), `textWidth` measures it in pixels from busy-lib's font maps,
  and `fitText` cuts it to a width with `..`.
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
} from '@busy-bar-apps/bar-kit';

await runBarApp({
  name: 'my-app',
  client: createBusyBar(loadBarConfig()),
  render: () => [
    { id: 'hi', type: 'text', text: 'HI', font: 'normal', x: 2, y: 2 },
  ],
  intervalMs: 1000,
  signal: shutdownSignal(),
});
```

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p bar-kit
```
