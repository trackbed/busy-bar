# catalogue

The app catalogue: one landing page that shows every BUSY Bar app in the
workspace, what it is for, how it works, and what it draws in its most telling
states.

```sh
NX_DAEMON=false yarn nx run catalogue:build
open dist/catalogue/index.html
```

The page is a single self-contained HTML file: the screenshots are inlined, so
it works opened from disk or hosted anywhere.

## Owns

- Finding the apps: every `type:app` project in the Nx graph
  ([src/apps.ts](src/apps.ts)). There is no list to keep up to date.
- Running each app's `preview` target and checking what it prints
  ([src/preview.ts](src/preview.ts)).
- Drawing each scene with the emulator, as the app's `application_name`
  ([src/catalogue.ts](src/catalogue.ts)). A scene the bar would refuse fails
  the build with the bar's own error message; any other failure fails it
  with its stack trace.
- The page ([src/page.ts](src/page.ts), [src/page.css](src/page.css)).

## Does Not Own

- What an app says about itself or draws. Each app's `preview` module
  (`src/preview.ts`, or `src/<module>/preview.py`) calls the app's own render
  function with sample data and prints a `Preview`, the contract in
  [`bar-kit`](../../libs/bar-kit/src/preview.ts) and
  [`bar-kit-py`](../../libs/bar-kit-py/src/bar_kit/preview.py).
- Drawing. The [emulator](../emulator/README.md) draws with the pinned
  firmware's fonts; the first build downloads them (about 12 MB) into the same
  cache the emulator uses.

## Start Here

- A new app shows up on its own: the generator writes a `preview` module, and
  `repo:check-projects` fails for an app without a `preview` target.
- Changed what an app draws? Update its preview's scenes and captions in the
  same change, then rebuild the page and look at it.
- `NX_DAEMON=false yarn nx run <app>:preview` prints one app's preview JSON.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p catalogue
NX_DAEMON=false yarn nx run catalogue:build
```
