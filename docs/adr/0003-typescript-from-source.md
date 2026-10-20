# Run TypeScript From Source and Type-Check With TypeScript 7

- Status: Accepted
- Date: 2026-10-19
- Area: TypeScript toolchain

## Context

BUSY Bar apps are long-running Node.js processes that poll data and push
frames; none ships to a browser or a registry. Node 24 strips TypeScript types
at runtime, without a flag or warning, for files outside `node_modules`.
Workspace packages are symlinks into `libs/`, so their real paths qualify.

TypeScript 7.0 (`typescript@7.0.2`) is the native compiler: much faster, but
without a JavaScript API until 7.1. typescript-eslint 8.71 and Nx 23 load that
API and require TypeScript below 6.1. Discera solved the same problem in its
ADR 0062.

## Decision

- Apps and libraries run from source (`node src/main.ts`) with no build step.
  `tsconfig.base.json` enforces what type stripping needs:
  `erasableSyntaxOnly`, `verbatimModuleSyntax`, and relative imports with
  `.ts` extensions (`allowImportingTsExtensions`).
- Library `exports` point at `src/index.ts` for both the
  `@busy-bar-apps/source` condition and `default`, so Node, Vitest, and
  TypeScript resolve workspace packages to source.
- `typecheck` targets run `tsc --build` with declaration-only output, so
  project references stay incremental.
- Two TypeScript packages, through npm aliases:
  `"@typescript/native": "npm:typescript@7.0.2"` provides `tsc`, and
  `"typescript": "npm:@typescript/typescript6@6.0.2"` provides the API for
  ESLint and Nx.

## Consequences

- No `enum`, `namespace`, or constructor parameter properties.
- An app deploys as the repository plus `yarn install`; there is no
  single-file artifact.
- Editors need either the TypeScript 7 extension or the TypeScript 6 server
  in `node_modules/@typescript/old/lib` (configured for VS Code).

## Revisit

Revisit when an app needs a standalone bundle or a non-Node runtime, and when
TypeScript 7.1 ships its API: then drop the aliases and let `typescript`
resolve to TypeScript 7.
