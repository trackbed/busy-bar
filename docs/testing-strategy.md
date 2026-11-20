# Testing Strategy

Status: Current.

1. **Keep drawing pure.** A render function takes a moment in time (and
   settings) and returns display elements. Test it directly with a pinned
   time; that is where an app's behavior lives.
2. **Mock only the boundary.** Replace the busylib client with a fake that
   records draws (`BarDisplayClient` in TypeScript, `DisplayClient` in
   Python), and pin the clock and process signals. Keep the project's own
   modules real. Convex functions run against `convex-test`'s in-memory
   backend ([ADR 0005](adr/0005-convex-between-bars.md)).
3. **Assert what the bar receives**: the `application_name`, the elements,
   and their text, position, and colour. Avoid asserting how the code got
   there.
4. **Name the expected failure.** Use `toThrow(ErrorType)` or a message in
   Vitest, and `pytest.raises(Error, match=...)` in pytest.
5. **Isolation is on by default.** Vitest restores mocks, environment
   variables, and globals after each test. pytest runs in strict mode and
   turns warnings into errors.
6. **Coverage thresholds are per project and apply on every run.** Exclude a
   process entry point (`src/main.ts`, `__main__.py`) instead of writing a
   test that only executes its lines. Raise thresholds as coverage grows;
   never lower one to pass.
7. **Hardware is checked by hand.** Run the app with `nx run <app>:start`
   against the emulator ([tools/emulator](../tools/emulator/README.md)), then
   a real bar, before you rely on a layout. The emulator draws with the
   bar's fonts and canvas rules, so what it shows is what the bar shows.
   Unit tests cannot see how text looks on the LEDs, but they can check that
   it fits: assert that the kit's `overflowingText` / `overflowing_text` finds
   nothing, as the apps' render and preview tests do. It places each text
   element by its `x` and `align` the way the bar does.
   `nx run catalogue:build` draws every app's preview scenes with the emulator
   on one page.

TypeScript tests live next to the code as `*.test.ts`; Python tests live in
`tests/test_*.py`. `async` tests run directly in both languages.
