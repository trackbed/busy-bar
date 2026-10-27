# Architecture Decision Records

An ADR records a decision with lasting consequences: what was decided, why,
what it costs, and when to reconsider it. This table is the only list.

| ADR                                    | Status   | Date       | Decision                                                                |
| -------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------- |
| [0001](0001-polyglot-nx-workspace.md)  | Accepted | 2026-10-19 | One Nx workspace for TypeScript and Python apps                         |
| [0002](0002-local-python-nx-plugin.md) | Accepted | 2026-10-19 | Infer Python targets with a local Nx plugin instead of `@nxlv/python`   |
| [0003](0003-typescript-from-source.md) | Accepted | 2026-10-19 | Run TypeScript from source; type-check with TypeScript 7                |
| [0004](0004-firmware-emulator.md)      | Accepted | 2026-10-20 | Emulate the bar from its firmware source; download assets, never vendor |
| [0005](0005-convex-between-bars.md)    | Accepted | 2026-10-26 | Share state between bars through a Convex deployment per team           |

## Adding an ADR

1. Take the next number and name the file `NNNN-kebab-case-title.md`.
2. Start with a title and these fields, then the sections below:

   ```markdown
   # Decision Title

   - Status: Accepted
   - Date: YYYY-MM-DD
   - Area: The part of the system it governs

   ## Context

   ## Decision

   ## Consequences

   ## Revisit
   ```

3. `Status` is one of `Accepted`, `Deferred`, `Historical`, or
   `Superseded by ADR NNNN`. Never delete an ADR; supersede it.
4. Add a row to the table above in the same change.
