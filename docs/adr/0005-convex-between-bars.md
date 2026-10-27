# Share State Between Bars Through Convex

- Status: Accepted
- Date: 2026-10-26
- Area: Apps that show one bar what another bar is doing, starting with
  `apps/intercom`

## Context

A team wants each BUSY Bar to show who else is free. Bars run no code of
their own and cannot reach each other: every app is a process near its bar
that draws through the bar's HTTP API. The bar reports its buttons only on a
local WebSocket that the BUSY cloud refuses, and its BUSY timer only through
its own API (`GET /api/busy/snapshot`). So whatever two-way features follow
need one process per bar, on USB or Wi-Fi, and a shared backend those
processes can reach.

The backend has to push changes within seconds, not on a poll: a team of ten
bars polling a shared HTTP endpoint every few seconds spends most of its work
on nothing changing. `event-day` already reads a Convex deployment, but over
the HTTP API, which polls.

## Decision

- Each multi-bar app keeps its Convex functions inside the app, in
  `src/convex/` (`convex.json` points there), with the generated
  `src/convex/_generated/` committed. Apps may depend only on libraries, and
  the library lint preset forbids the default exports Convex needs
  (`schema.ts`). The functions move to a library once a second project uses
  them.
- Bars connect with `convex/browser`'s `ConvexClient`, which has a Node build
  over WebSockets: one subscription per bar, re-run only when the data it
  reads changes, and mutations for what the bar reports.
- One Convex deployment holds one trusted team, on Convex's hosted cloud. The
  deployment owner adds bars with an internal mutation run from the CLI
  (`bars:add`), which answers a random key. Convex stores only the key's
  SHA-256, and every public function requires it. Nothing is public.
- Bars write only when what they show changes. A heartbeat rewrites a row
  that no subscription reads, so it re-runs no subscription. A running timer
  is sent once as its end time, and every bar counts down on its own clock.
  Queries never read the clock.
- Convex never reaches a bar. A team focus is a row in Convex; each bar's
  own process starts its BUSY timer with `PUT /api/busy/snapshot`, stamped
  with the session's start, so the bars end together without Convex
  holding their tokens.
- The app reads its deployment from `INTERCOM_CONVEX_URL`, not the CLI's
  `CONVEX_URL`, which `convex dev` points at the owner's dev deployment.
- `convex-test` tests the functions against an in-memory backend in Node.
  Development and end-to-end checks can use a local Convex deployment, which
  needs no account.

## Consequences

- Bars need no inbound network access and no shared secret beyond their own
  key. A bar's owner never needs a Convex account.
- Every report is a Convex function call, and every changed row re-runs the
  board for each subscribed bar. A 60-second heartbeat costs about 43,000
  calls a bar a month, inside the free plan's million for a small team.
- Adding a function file means regenerating `_generated/` with
  `nx run intercom:backend` and committing it; code that calls a function
  the generated API does not list fails typecheck.
- The project depends on `convex`, which bundles esbuild for `convex dev`.
  Its install script stays disabled; esbuild runs from its platform package.
- A deployment is one team: a second team runs a second deployment.

## Revisit

Revisit when bars need to know who is asking (people, not bars, sending
knocks from a web page), when one deployment should hold more than one team,
or when the BUSY firmware's on-device JavaScript SDK can talk to a backend
itself.
