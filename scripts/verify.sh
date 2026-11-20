#!/usr/bin/env bash
# The local quality gate, matching what CI runs for the projects a branch
# affects. `yarn verify` runs everything once before the first push;
# `yarn verify:fast` skips tests and Knip while iterating. Every check runs
# even after one fails, so one run reports every problem. See
# docs/command-reference.md#verification-tiers.
set -euo pipefail

export NX_DAEMON="${NX_DAEMON:-false}"

fast=false
if [[ "${1:-}" == "--fast" ]]; then
  fast=true
fi

# The checks below mean nothing until the workspace is set up.
node scripts/check-workspace-ready.mjs --quiet

failed=''
check() {
  if ! "$@"; then
    failed="$failed
  - $*"
  fi
}

check yarn format:check
check yarn nx sync:check
check yarn nx run repo:check-projects --outputStyle=static

if [[ "$fast" == true ]]; then
  check yarn nx affected -t lint typecheck --outputStyle=static
else
  check yarn nx run repo:knip --outputStyle=static
  check yarn nx affected -t lint typecheck test --outputStyle=static
fi

if [[ -n "$failed" ]]; then
  echo "verify: these checks failed:$failed" >&2
  exit 1
fi
