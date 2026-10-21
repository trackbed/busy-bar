# json-values

Primitive validation for untrusted JSON in TypeScript apps, published as
`@busy-bar-apps/json-values`.

## Owns

- Object narrowing with `isObject` and the unchecked `JsonObject` type.
- Object and array accessors that return empty values for missing or malformed fields.
- String and finite-number accessors that return `undefined` without coercion.

## Does Not Own

- Service-specific response schemas, errors, or network calls: each app owns those.
- Display text, connection settings, or the frame loop: [`bar-kit`](../bar-kit/README.md).

## Start Here

- `src/index.ts`: the public API. Import the library as
  `@busy-bar-apps/json-values`.
- `src/json-values.ts`: the shared accessors; `src/json-values.test.ts` checks
  missing fields, wrong types, and non-finite numbers.

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p json-values
```
