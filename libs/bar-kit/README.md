# bar-kit

Shared plumbing for TypeScript BUSY Bar apps, published in the workspace as
`@busy-bar-apps/bar-kit`. The Python counterpart is
[`bar-kit-py`](../bar-kit-py/README.md); both read the same environment
variables and behave the same way.

## Owns

- Connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`
  (`loadBarConfig`) and the busy-lib client built from them (`createBusyBar`).
- Display sizes (`FRONT_DISPLAY`, `BACK_DISPLAY`) and colours (`rgba`).
- The frame loop (`runBarApp`): draw every interval at a `priority`
  (default `DEFAULT_PRIORITY`, 50), log failed draws and keep going, clear the
  display on shutdown (`shutdownSignal`).
- Re-exports of busy-lib's element types (`TextElement`, `RectangleElement`,
  and others) so apps need only this package.

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
