import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from './sync.ts';
import {
  AssetSyncError,
  commitDir,
  gitBlobSha,
  rawUrl,
  syncAssets,
} from './sync.ts';

const FONT = new TextEncoder().encode('font bytes');
const SOUND = new TextEncoder().encode('sound bytes');

const MANIFEST: AssetManifest = {
  repository: 'busy-app/busybar-firmware',
  commit: 'abc123',
  files: [
    {
      path: 'assets/shared/fonts/busy_tiny.font',
      sha: gitBlobSha(FONT),
      size: FONT.length,
    },
    {
      path: 'assets/shared/sounds/beep.wav',
      sha: gitBlobSha(SOUND),
      size: SOUND.length,
    },
  ],
};

function serving(files: Readonly<Record<string, Uint8Array>>) {
  return vi.fn<typeof fetch>((input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = url.split('/abc123/')[1] ?? '';
    const body = files[path];
    return Promise.resolve(
      body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(Uint8Array.from(body)),
    );
  });
}

async function cache(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'emulator-assets-'));
}

describe('gitBlobSha', () => {
  it('matches git hash-object', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(new TextEncoder().encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
  });
});

describe('syncAssets', () => {
  it('downloads every pinned file into a folder per commit', async () => {
    const dir = await cache();
    const fetch = serving({
      'assets/shared/fonts/busy_tiny.font': FONT,
      'assets/shared/sounds/beep.wav': SOUND,
    });
    const progress: number[] = [];

    const root = await syncAssets({
      manifest: MANIFEST,
      cacheDir: dir,
      fetch,
      concurrency: 1,
      onProgress: (done) => progress.push(done),
    });

    expect(root).toBe(commitDir(dir, MANIFEST));
    expect(
      await readFile(join(root, 'assets/shared/fonts/busy_tiny.font')),
    ).toStrictEqual(Buffer.from(FONT));
    expect(fetch).toHaveBeenCalledWith(
      rawUrl(MANIFEST, 'assets/shared/sounds/beep.wav'),
    );
    expect(progress).toStrictEqual([1, 2]);
  });

  it('keeps files that already match and replaces damaged ones', async () => {
    const dir = await cache();
    const root = commitDir(dir, MANIFEST);
    await mkdir(join(root, 'assets/shared/fonts'), { recursive: true });
    await mkdir(join(root, 'assets/shared/sounds'), { recursive: true });
    await writeFile(join(root, 'assets/shared/fonts/busy_tiny.font'), FONT);
    await writeFile(join(root, 'assets/shared/sounds/beep.wav'), 'damaged');
    const fetch = serving({ 'assets/shared/sounds/beep.wav': SOUND });

    await syncAssets({ manifest: MANIFEST, cacheDir: dir, fetch });

    expect(fetch).toHaveBeenCalledOnce();
    expect(
      await readFile(join(root, 'assets/shared/sounds/beep.wav')),
    ).toStrictEqual(Buffer.from(SOUND));
  });

  it('refuses a file that does not match its pinned hash', async () => {
    const fetch = serving({
      'assets/shared/fonts/busy_tiny.font': new TextEncoder().encode(
        'tampered',
      ),
      'assets/shared/sounds/beep.wav': SOUND,
    });

    await expect(
      syncAssets({ manifest: MANIFEST, cacheDir: await cache(), fetch }),
    ).rejects.toThrow('does not match its pinned hash');
  });

  // One worker, so the first file in the manifest is the one that fails.
  it('reports failed downloads', async () => {
    await expect(
      syncAssets({
        manifest: MANIFEST,
        cacheDir: await cache(),
        fetch: serving({}),
        concurrency: 1,
      }),
    ).rejects.toThrow(
      new AssetSyncError(
        'Downloading assets/shared/fonts/busy_tiny.font failed with 404.',
      ),
    );

    const offline = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    await expect(
      syncAssets({
        manifest: MANIFEST,
        cacheDir: await cache(),
        fetch: offline,
        concurrency: 1,
      }),
    ).rejects.toThrow('Could not download assets/shared/fonts/busy_tiny.font.');
  });
});
