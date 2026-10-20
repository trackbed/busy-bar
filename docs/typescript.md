# TypeScript

Status: Current.

## Toolchain

| Tool       | Version | Pinned in                              |
| ---------- | ------- | -------------------------------------- |
| Node.js    | 24.21.0 | `.node-version`, `.nvmrc`, `engines`   |
| Yarn       | 4.18.1  | `packageManager`, provided by Corepack |
| TypeScript | 7.0.2   | `@typescript/native` (provides `tsc`)  |
| TS 6 API   | 6.0.2   | `typescript` (loaded by ESLint and Nx) |
| ESLint     | 10.12.0 | root `package.json`                    |
| Oxlint     | 1.87.0  | root `package.json`                    |
| Oxfmt      | 0.72.0  | root `package.json`                    |
| Vitest     | 5.0.4   | root `package.json`                    |

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
Nx module boundaries, import-cycle detection, Vitest rules for tests, and a
required reason on every `eslint-disable` comment. eslint-plugin-oxlint turns
off ESLint rules that Oxlint already covers.

## Tests

[vitest.factory.mjs](../vitest.factory.mjs) builds every project's
`vitest.config.ts`. Tests run in Node, live next to the code as `*.test.ts`,
import from `vitest` explicitly (no globals), and restore mocks, environment
variables, and globals after each test. Coverage is always on, and each
project sets thresholds. See [testing-strategy.md](testing-strategy.md).
