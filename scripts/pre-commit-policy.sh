#!/bin/sh
# Pre-commit policy: fast, check-only gates on staged files. Lefthook runs this
# script, and `yarn hooks:policy:pre-commit` runs it directly. It never rewrites
# files; run `yarn format:write` to fix formatting. Type-aware lint, typecheck,
# and tests belong to `yarn verify` and CI. Budget: a few seconds.
set -eu

export NX_DAEMON=false

staged=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -z "$staged" ]; then
  exit 0
fi

select_files() {
  printf '%s\n' "$staged" | grep -E "$1" || true
}

# Runs "$@" with the newline-separated file list in $files appended.
run_on_files() {
  if [ -n "$files" ]; then
    printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 "$@"
  fi
}

failed=0

if [ -x node_modules/.bin/oxfmt ]; then
  files=$(select_files '\.(c|m)?(j|t)sx?$|\.jsonc?$|\.md$|\.ya?ml$')
  run_on_files node_modules/.bin/oxfmt --check --no-error-on-unmatched-pattern || failed=1

  files=$(select_files '^(apps|libs|tools)/[^/]+/.+\.(c|m)?(j|t)sx?$')
  run_on_files node_modules/.bin/oxlint --deny-warnings || failed=1
else
  echo '[pre-commit] node_modules is missing; skipped Oxfmt and Oxlint. Run `yarn install`.' >&2
fi

files=$(select_files '\.py$')
if [ -n "$files" ]; then
  if command -v uv >/dev/null 2>&1; then
    run_on_files uv run --quiet ruff format --check || failed=1
    run_on_files uv run --quiet ruff check || failed=1
  else
    echo '[pre-commit] uv is not installed; skipped Ruff. See README.md#prerequisites.' >&2
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo '[pre-commit] Fix the issues above (`yarn format:write` fixes formatting), then commit again.' >&2
  exit 1
fi
