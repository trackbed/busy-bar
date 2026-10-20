// @ts-check
// Read-only readiness check that works before anything is installed: the
// pinned Node version, the Yarn install, uv, the Python environment, and the
// Git hooks. Prints one line per problem with the command that fixes it.
// `yarn bootstrap:status` runs it; `--quiet` prints only problems.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
const quiet = process.argv.includes('--quiet');
/** @type {string[]} */
const problems = [];

const pinnedNode = readFileSync(join(root, '.node-version'), 'utf8').trim();
if (process.version !== `v${pinnedNode}`) {
  problems.push(
    `Node ${process.version} is running; the workspace pins ${pinnedNode}. Run \`nvm install\` (or \`fnm use\`) in the repository root.`,
  );
}

/**
 * Whether `artifact` exists and is at least as new as `source`.
 * @param {string} artifact
 * @param {string} source
 */
function isFresh(artifact, source) {
  return (
    existsSync(join(root, artifact)) &&
    statSync(join(root, artifact)).mtimeMs >=
      statSync(join(root, source)).mtimeMs
  );
}

if (!isFresh('node_modules/.yarn-state.yml', 'yarn.lock')) {
  problems.push(
    'Node dependencies are missing or older than yarn.lock. Run `corepack enable && yarn install`.',
  );
}

const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
if (uv.status !== 0) {
  problems.push(
    'uv is not installed. Install it from https://docs.astral.sh/uv/getting-started/installation/.',
  );
} else if (
  spawnSync('uv', ['sync', '--all-packages', '--check', '--quiet'], {
    cwd: root,
  }).status !== 0
) {
  problems.push(
    'The Python environment does not match uv.lock. Run `uv sync --all-packages`.',
  );
}

const hooks = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
  cwd: root,
  encoding: 'utf8',
});
if (
  hooks.status === 0 &&
  // --git-path is relative in a checkout and absolute in a worktree.
  !existsSync(resolve(root, hooks.stdout.trim(), 'pre-commit'))
) {
  problems.push('Git hooks are not installed. Run `yarn hooks:install`.');
}

if (problems.length > 0) {
  console.error(
    `Workspace not ready:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
  );
  process.exit(1);
}

if (!quiet) {
  console.log(
    `Workspace ready: Node ${process.version}, ${uv.stdout.trim()}, dependencies installed.`,
  );
}
