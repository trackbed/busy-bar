// @ts-check
// Read-only readiness check that works before anything is installed: the
// pinned Node version, the Yarn install, uv, the Python environment, and the
// Git hooks. Prints one line per problem with the command that fixes it.
// Run it as `node scripts/check-workspace-ready.mjs`, which needs only Node;
// `yarn bootstrap:status` runs it too once Yarn can start. `--quiet` prints
// only problems.

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
    `Node ${process.version} is running; the workspace pins ${pinnedNode}. Install Node ${pinnedNode} and put it first on PATH: \`bash scripts/setup-workspace.sh\` installs it with mise, fnm, or nvm and prints how.`,
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

// Yarn rewrites .yarn-state.yml when it relinks node_modules and its install
// state (installStatePath in .yarnrc.yml) when the lockfile changes, so an
// install after a lockfile change can leave either one older than yarn.lock.
if (
  !existsSync(join(root, 'node_modules/.yarn-state.yml')) ||
  !(
    isFresh('node_modules/.yarn-state.yml', 'yarn.lock') ||
    isFresh('node_modules/.yarn-install-state.gz', 'yarn.lock')
  )
) {
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
