// Pin the emulator to a firmware commit: `nx run emulator:pin-firmware -- <sha>`.
// Rewrites src/assets/firmware-assets.json from GitHub's tree at that commit.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  FIRMWARE_REPOSITORY,
  manifestFromTree,
  parseTree,
} from './assets/pin.ts';

const commit = process.argv[2]?.trim() ?? '';
if (!/^[0-9a-f]{40}$/u.test(commit)) {
  console.error(
    'Pass the full 40-character commit SHA to pin, for example from the dev branch.',
  );
  process.exit(1);
}

const response = await fetch(
  `https://api.github.com/repos/${FIRMWARE_REPOSITORY}/git/trees/${commit}?recursive=1`,
  {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'busy-bar-apps-emulator',
    },
  },
);
if (!response.ok) {
  console.error(`GitHub answered ${response.status} for ${commit}.`);
  process.exit(1);
}
const { truncated, entries } = parseTree(await response.json());
if (truncated) {
  console.error(
    'GitHub truncated the tree listing; the manifest would be incomplete.',
  );
  process.exit(1);
}
const manifest = manifestFromTree(commit, entries);
const target = join(import.meta.dirname, 'assets', 'firmware-assets.json');
await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
const bytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
console.log(
  `Pinned ${manifest.files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) at ${commit}.`,
);
