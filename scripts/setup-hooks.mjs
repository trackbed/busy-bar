// @ts-check
// Installs the Lefthook Git hooks. Runs as the root postinstall script and as
// `yarn hooks:install`. Outside a Git work tree (for example a container build
// that copies the sources without .git) it skips instead of failing the install.

import { spawnSync } from 'node:child_process';

const workTree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  encoding: 'utf8',
});

if (workTree.status !== 0 || workTree.stdout.trim() !== 'true') {
  console.log('[hooks] Not inside a Git work tree; skipping Lefthook install.');
  process.exit(0);
}

const install = spawnSync('lefthook', ['install'], { stdio: 'inherit' });
if (install.error) {
  throw install.error;
}
process.exit(install.status ?? 1);
