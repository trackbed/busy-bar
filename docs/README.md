# Documentation

## Start Here by Task

| Task                                              | Read                                         |
| ------------------------------------------------- | -------------------------------------------- |
| Install, run an app, or connect to a bar          | [README.md](../README.md)                    |
| Understand the displays, fonts, and HTTP API      | [busy-bar.md](busy-bar.md)                   |
| Add an app or library; tags and naming            | [project-structure.md](project-structure.md) |
| Work on TypeScript code or its tooling            | [typescript.md](typescript.md)               |
| Work on Python code, uv, or the Nx Python plugin  | [python.md](python.md)                       |
| Find a command, verify a change, or understand CI | [command-reference.md](command-reference.md) |
| Write tests                                       | [testing-strategy.md](testing-strategy.md)   |
| Add, update, or audit a dependency                | [dependencies.md](dependencies.md)           |
| Understand why something is the way it is         | [adr/README.md](adr/README.md)               |

## Authority

When two documents disagree, the first one in this list wins; fix the other
in the same change:

1. [AGENTS.md](../AGENTS.md)
2. Project READMEs
3. Configuration and scripts (`nx.json`, `pyproject.toml`, `scripts/`)
4. The guides in this directory

## Status Labels

Every guide states its status near the top:

- `Current`: describes how the repository works today.
- `Proposal`: a plan, not yet true.
- `Historical`: kept for context; no longer true.
