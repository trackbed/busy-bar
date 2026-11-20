#!/usr/bin/env bash
# Sets up a checkout or worktree in one step: the pinned Node, the Node and
# Python dependencies, and the Git hooks, then the readiness check. Safe to
# rerun. See docs/command-reference.md#setup.
set -euo pipefail

cd "$(dirname "$0")/.."

pinned="$(cat .node-version)"
shell_node="$(node --version 2>/dev/null || echo 'no Node')"
path_hint=''

if ! command -v uv >/dev/null 2>&1; then
  echo 'setup: uv is not installed; see https://docs.astral.sh/uv/getting-started/installation/.' >&2
  exit 1
fi

# When the shell runs another Node, install the pinned one with the first
# version manager found and put it first on PATH for the rest of this script.
if [[ "$shell_node" != "v$pinned" ]]; then
  if command -v mise >/dev/null 2>&1; then
    mise install "node@$pinned"
    node_bin="$(mise where "node@$pinned")/bin"
    PATH="$node_bin:$PATH"
    path_hint="export PATH=\"$node_bin:\$PATH\""
  elif command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash)"
    fnm use --install-if-missing "$pinned"
    path_hint='fnm use   # in the repository root'
  elif [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    # nvm's scripts read unset variables.
    set +u
    # shellcheck source=/dev/null
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm install "$pinned"
    set -u
    path_hint='nvm use   # in the repository root'
  else
    echo "setup: the shell runs $shell_node, the workspace pins Node $pinned, and no mise, fnm, or nvm was found to install it. Install Node $pinned, put it first on PATH, and rerun this script." >&2
    exit 1
  fi
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
# Installs the Git hooks too, through the root postinstall script.
yarn install
uv sync --all-packages
node scripts/check-workspace-ready.mjs

if [[ -n "$path_hint" ]]; then
  echo "Your shell still runs $shell_node. Put Node $pinned first before running Nx:"
  echo "  $path_hint"
fi
