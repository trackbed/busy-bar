// Building the asset manifest from the firmware repository's file tree at a
// commit. Run by `nx run emulator:pin-firmware` when moving to a newer
// firmware; the result is committed as firmware-assets.json.

import type { AssetManifest, PinnedFile } from './sync.ts';

export const FIRMWARE_REPOSITORY = 'busy-app/busybar-firmware';

// What the emulator draws, plays, and credits: the device fonts, the stock
// images, animations, and sounds apps can address (a `stock_path` resolves
// by its basename under /ext/apps_assets/shared on the device), as their PNG,
// ZIP, and WAV sources, the icon the bar draws for an asset it cannot load,
// and the licences they ship under.
const INCLUDED: readonly RegExp[] = [
  /^assets\/shared\/fonts\/[^/]+\.font$/u,
  /^assets\/shared\/images\/external\/[^/]+\.png$/u,
  /^assets\/images\/internal\/load_error_9x9\.png$/u,
  /^assets\/shared\/animations\/[^/]+\.zip$/u,
  /^assets\/shared\/sounds\/[^/]+\.wav$/u,
  /^LICENSES\/(?:CC-BY-SA-4\.0|OFL-1\.1)\.txt$/u,
  /^REUSE\.toml$/u,
];

/** One entry of GitHub's recursive tree listing. */
export interface TreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
}

/** The manifest for `commit`, from the repository's tree at that commit. */
export function manifestFromTree(
  commit: string,
  tree: readonly TreeEntry[],
): AssetManifest {
  const files: PinnedFile[] = tree
    .filter(
      (entry) =>
        entry.type === 'blob' &&
        INCLUDED.some((pattern) => pattern.test(entry.path)),
    )
    .map((entry) => ({
      path: entry.path,
      sha: entry.sha,
      size: entry.size ?? 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { repository: FIRMWARE_REPOSITORY, commit, files };
}

/** Read GitHub's tree listing, keeping only well-formed entries. */
export function parseTree(body: unknown): {
  readonly truncated: boolean;
  readonly entries: TreeEntry[];
} {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('tree' in body) ||
    !Array.isArray(body.tree)
  ) {
    throw new Error('GitHub sent no tree.');
  }
  const truncated = 'truncated' in body && body.truncated === true;
  const entries = body.tree.flatMap((entry: unknown): TreeEntry[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const path = 'path' in entry ? entry.path : undefined;
    const type = 'type' in entry ? entry.type : undefined;
    const sha = 'sha' in entry ? entry.sha : undefined;
    const size = 'size' in entry ? entry.size : undefined;
    if (
      typeof path !== 'string' ||
      typeof type !== 'string' ||
      typeof sha !== 'string'
    ) {
      return [];
    }
    return [{ path, type, sha, ...(typeof size === 'number' ? { size } : {}) }];
  });
  return { truncated, entries };
}
