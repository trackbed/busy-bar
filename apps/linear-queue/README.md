# linear-queue

A BUSY Bar app in TypeScript that gauges a Linear team's queue, the DISC team
by default. The front display shows how many issues are ready to start,
coloured by whether the queue is running low, with what is in progress and in
review, over a strip that splits the active queue between those stages. The
back display lists every stage, the backlog, and the past week's completions.
When ready runs low, it is time for another backlog-refine pass.

## Owns

- Counting the queue ([src/linear.ts](src/linear.ts)): Linear's GraphQL issue
  search, 250 issues a page, up to 5,000 per count (a `+` marks a lower
  bound), every 3 minutes and a minute after a failure.
- The layout ([src/render.ts](src/render.ts)).

## Does Not Own

- Primitive JSON validation: [`json-values`](../../libs/json-values/README.md).
- Deciding what is ready. Linear's states and labels do;
  `kramme:linear:backlog-refine` grades readiness in its report but writes no
  label.
- Connection settings, the frame loop, polling, and shutdown handling. Those
  live in [`bar-kit`](../../libs/bar-kit/README.md).

## Start Here

`fetchQueue` sorts the team's open issues by state type: `backlog`,
`unstarted`, and `started`, with started issues whose state name mentions
review counted as in review. **Ready** is every unstarted issue (Todo) by
default. Teams that move issues straight from Backlog to In Progress, as DISC
does, read 0 there. For them, set `LINEAR_QUEUE_LABEL` (for example
`agent-ready`) and label the issues an agent can pick up: ready then counts
labelled issues in Backlog or Todo.

## Run

```sh
NX_DAEMON=false yarn nx run linear-queue:start
```

| Variable                | Default    | What it does                                        |
| ----------------------- | ---------- | --------------------------------------------------- |
| `LINEAR_API_KEY`        | (required) | A personal API key: Settings > Account > Security   |
| `LINEAR_QUEUE_TEAM`     | `DISC`     | The team key                                        |
| `LINEAR_QUEUE_LABEL`    | (none)     | The label that marks an issue as ready              |
| `LINEAR_QUEUE_ASSIGNEE` | (none)     | `me` counts only issues assigned to the key's owner |
| `LINEAR_QUEUE_LOW`      | `3`        | Below this many ready issues, the count turns amber |

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p linear-queue
```
