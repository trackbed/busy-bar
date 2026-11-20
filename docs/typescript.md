# TypeScript

Status: Current.

## Toolchain

| Tool                          | Pinned in                                               |
| ----------------------------- | ------------------------------------------------------- |
| Node.js 24                    | `.node-version` and `.nvmrc`; `engines` allows any 24.x |
| Yarn 4                        | `packageManager`, provided by Corepack                  |
| TypeScript 7                  | `@typescript/native` in the root `package.json` (`tsc`) |
| TypeScript 6 API              | `typescript` in the root `package.json` (ESLint and Nx) |
| ESLint, Oxlint, Oxfmt, Vitest | root `package.json`                                     |

The files in the second column hold the exact versions, and Dependabot bumps
the npm ones weekly, so this guide names only major versions.

TypeScript 7 is the native compiler and has no JavaScript API yet, so the
`typescript` package name resolves to the TypeScript 6 API that
typescript-eslint and Nx load, while `tsc` runs TypeScript 7
([ADR 0003](adr/0003-typescript-from-source.md)).

**Editors.** `node_modules/typescript` has no language server. The checked-in
`.vscode/settings.json` points VS Code at the TypeScript 6 server in
`node_modules/@typescript/old/lib`; alternatively install the TypeScript 7
extension. The `typecheck` targets are authoritative either way.

## Running From Source

Apps run their `.ts` files directly: `node src/main.ts`. Node 24 strips the
types, so there is no build step. That has three consequences, all enforced by
`tsconfig.base.json`:

- Only erasable syntax (`erasableSyntaxOnly`): no `enum`, `namespace`, or
  constructor parameter properties. Use union types and plain classes.
- Relative imports name the `.ts` file: `import { x } from './x.ts'`.
- Type-only imports use `import type` (`verbatimModuleSyntax`).

Libraries export their source. `package.json` `exports` points both the
`@busy-bar-apps/source` condition and `default` at `src/index.ts`, so Node,
Vitest, and TypeScript all resolve a workspace package to its source.

## Configuration Layout

Each project has three tsconfig files:

- `tsconfig.json`: a solution file that references the other two.
- `tsconfig.lib.json`: the source under `src/`, minus tests. References the
  `tsconfig.lib.json` of every workspace package it imports.
- `tsconfig.spec.json`: the tests and `vitest.config.ts`.

`tsconfig.base.json` holds the strict compiler options. The root `tsconfig.json`
references every project. `NX_DAEMON=false yarn nx sync` keeps all references
in line with the project graph, and CI fails on drift.

## Targets

| Target      | Comes from               | Runs                                               |
| ----------- | ------------------------ | -------------------------------------------------- |
| `typecheck` | `@nx/js/typescript`      | `tsc --build` for the project and its dependencies |
| `oxlint`    | `@nx/oxlint`             | Oxlint correctness rules, warnings fail            |
| `lint`      | `@nx/eslint/plugin`      | ESLint, after `oxlint`                             |
| `test`      | `@nx/vitest`             | `vitest run` with coverage thresholds              |
| `start`     | the app's `project.json` | `node src/main.ts`                                 |

## Linting

Oxlint runs the fast correctness rules first. ESLint then runs everything that
needs types or project context, configured by
[eslint.factory.mjs](../eslint.factory.mjs) for three kinds of project:

- `app`: may log to the console.
- `lib`: no console output and no default exports in `src/`.
- `tooling`: workspace tooling.

All kinds get typescript-eslint's strict and stylistic type-checked presets,
a ban on type assertions other than `as const`, Nx module boundaries,
import-cycle detection, Vitest rules for tests, and a required reason on every
`eslint-disable` comment. eslint-plugin-oxlint turns
off ESLint rules that Oxlint already covers.

## Tests

[vitest.factory.mjs](../vitest.factory.mjs) builds every project's
`vitest.config.ts`. Tests run in Node, live next to the code as `*.test.ts`,
import from `vitest` explicitly (no globals), and restore mocks, environment
variables, and globals after each test. Coverage is always on, and each
project sets thresholds. See [testing-strategy.md](testing-strategy.md).
