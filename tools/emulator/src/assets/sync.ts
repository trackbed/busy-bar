// Downloads the firmware's stock assets at a pinned commit and verifies each
// file against its Git blob hash. The assets are CC-BY-SA and OFL licensed,
// so the repository records only their paths and hashes, never the files
// (docs/adr/0004-firmware-emulator.md).

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** One firmware file, as Git records it at the pinned commit. */
export interface PinnedFile {
  readonly path: string;
  /** The Git blob hash: SHA-1 of `blob <size>\0<content>`. */
  readonly sha: string;
  readonly size: number;
}

/** The firmware files the emulator draws with, pinned to one commit. */
export interface AssetManifest {
  readonly repository: string;
  readonly commit: string;
  readonly files: readonly PinnedFile[];
}

/** A download failed or a file did not match its pinned hash. */
export class AssetSyncError extends Error {
  override readonly name = 'AssetSyncError';
}

export interface SyncOptions {
  readonly manifest: AssetManifest;
  /** Where downloaded files go; one folder per commit is created inside. */
  readonly cacheDir: string;
  readonly fetch?: typeof fetch;
  readonly concurrency?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

/** The Git blob hash of `data`, as `git hash-object` prints it. */
export function gitBlobSha(data: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${data.length}\0`)
    .update(data)
    .digest('hex');
}

/** The folder a commit's assets are kept in. */
export function commitDir(cacheDir: string, manifest: AssetManifest): string {
  return join(cacheDir, `firmware-${manifest.commit}`);
}

/**
 * Make sure every pinned file is in the cache, downloading the missing or
 * damaged ones. Returns the commit's folder. Files already present with the
 * right hash are not fetched again, so later starts work offline.
 */
export async function syncAssets(options: SyncOptions): Promise<string> {
  const {
    manifest,
    cacheDir,
    fetch: fetchImpl = fetch,
    concurrency = 8,
    onProgress,
  } = options;
  const root = commitDir(cacheDir, manifest);
  const queue = [...manifest.files];
  let done = 0;

  async function worker(): Promise<void> {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      await ensureFile(root, manifest, file, fetchImpl);
      done += 1;
      onProgress?.(done, manifest.files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return root;
}

/** The raw download URL of a pinned file. */
export function rawUrl(manifest: AssetManifest, path: string): string {
  return `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${path}`;
}

async function ensureFile(
  root: string,
  manifest: AssetManifest,
  file: PinnedFile,
  fetchImpl: typeof fetch,
): Promise<void> {
  const target = join(root, file.path);
  const existing = await readFile(target).catch(() => undefined);
  if (existing !== undefined && gitBlobSha(existing) === file.sha) {
    return;
  }
  let response: Response;
  try {
    response = await fetchImpl(rawUrl(manifest, file.path));
  } catch (error) {
    throw new AssetSyncError(`Could not download ${file.path}.`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new AssetSyncError(
      `Downloading ${file.path} failed with ${response.status}.`,
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  const sha = gitBlobSha(data);
  if (sha !== file.sha) {
    throw new AssetSyncError(
      `${file.path} does not match its pinned hash (got ${sha}, expected ${file.sha}).`,
    );
  }
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await writeFile(partial, data);
  await rename(partial, target);
}
