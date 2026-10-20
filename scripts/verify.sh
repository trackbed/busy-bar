#!/usr/bin/env bash
# The local quality gate, matching what CI runs for the projects a branch
# affects. `yarn verify` runs everything once before the first push;
# `yarn verify:fast` skips tests and Knip while iterating. See
# docs/command-reference.md#verification-tiers.
set -euo pipefail

export NX_DAEMON="${NX_DAEMON:-false}"

fast=false
if [[ "${1:-}" == "--fast" ]]; then
  fast=true
fi

node scripts/check-workspace-ready.mjs --quiet
yarn format:check
yarn nx sync:check
yarn nx run repo:check-projects --outputStyle=static

if [[ "$fast" == true ]]; then
  yarn nx affected -t lint typecheck --outputStyle=static
else
  yarn nx run repo:knip --outputStyle=static
  yarn nx affected -t lint typecheck test --outputStyle=static
fi
