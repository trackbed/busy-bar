# Read Trackbed observations from local snapshots

- Status: Accepted
- Date: 2026-11-24
- Area: Trackbed views in agent-fleet and merge-ticker

## Context

Showtime resolves which workspaces need a person, review convergence records each
round, and the review queue computes PR readiness. Each workflow can finish
while the bar is disconnected. A display may start hours after a workflow ends.

## Decision

Trackbed projects its observations into versioned JSON files under the optional
`TRACKBED_BUSY_BAR_DIR`. Each app selects its view by the full path to one
snapshot. Trackbed serializes publishers per file and atomically replaces the
previous observation. The bar reads version 1 and dates the display from the
producer's `observedAt` timestamp.

| File                                              | Version 1 fields beyond `version` and `observedAt`                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `showtime-OWNER+REPO.json`                        | `scope`, `workspaces` with `id`, `name`, `group`, and `reason`                   |
| `review-WORKSPACE_ID.json`                        | `workspace`, `startedAt`, `workItem`, `phase`, `round`, `cycles`, and `lastGate` |
| `incoming-OWNER+REPO.json` or `incoming-all.json` | `scope`, `requests` with `pr`, `state`, `waitingSince`, and `waitingFrom`        |

Repository filenames use lowercase owner and repository names. The globally
unique Conductor workspace ID joins a review to its Showtime row. Each new
review starts its counters at zero. Timestamps carry a UTC offset. The queue
preserves Trackbed's request-time fallback so the display can mark an
estimated wait.

## Consequences

Readers require local file access. Contact with GitHub, Conductor and the
skill host stays with Trackbed. Reads that fail leave the last valid
observation visible. At fifteen minutes the overview switches to STALE and
an unfinished review shows LAST REVIEW. Hardware acknowledgement belongs to
the reader and expires when the reason clears.

## Revisit

Reconsider the transport if the computer running Trackbed and the one drawing
on the bar can no longer share a directory.
