import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

/** The pinned path a fetch asks for. */
function requestedPath(input: Parameters<typeof fetch>[0]): string {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return url.split('/abc123/')[1] ?? '';
}

function serving(files: Readonly<Record<string, Uint8Array>>) {
  return vi.fn<typeof fetch>((input) => {
    const body = files[requestedPath(input)];
    return Promise.resolve(
      body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(Uint8Array.from(body)),
    );
  });
}

/**
 * Serves each file only once two syncs have both asked for it, so both
 * write it at the same time.
 */
function servingBothAtOnce(files: Readonly<Record<string, Uint8Array>>) {
  const waiting = new Map<string, () => void>();
  return vi.fn<typeof fetch>(
    (input) =>
      new Promise((resolve) => {
        const path = requestedPath(input);
        const respond = () => {
          resolve(new Response(Uint8Array.from(files[path] ?? [])));
        };
        const first = waiting.get(path);
        if (first === undefined) {
          waiting.set(path, respond);
          return;
        }
        waiting.delete(path);
        first();
        respond();
      }),
  );
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

  it('lets two syncs of one folder download the same files at once', async () => {
    const dir = await cache();
    const files = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [
        `assets/shared/sounds/sound_${index}.wav`,
        new TextEncoder().encode(`sound ${index} `.repeat(4096)),
      ]),
    );
    const manifest: AssetManifest = {
      ...MANIFEST,
      files: Object.entries(files).map(([path, data]) => ({
        path,
        sha: gitBlobSha(data),
        size: data.length,
      })),
    };
    const fetch = servingBothAtOnce(files);

    const roots = await Promise.all([
      syncAssets({ manifest, cacheDir: dir, fetch }),
      syncAssets({ manifest, cacheDir: dir, fetch }),
    ]);

    expect(fetch).toHaveBeenCalledTimes(64);
    expect(roots[0]).toBe(roots[1]);
    for (const [path, data] of Object.entries(files)) {
      expect(
        gitBlobSha(await readFile(join(dir, `firmware-abc123/${path}`))),
      ).toBe(gitBlobSha(data));
    }
    expect(
      await readdir(join(commitDir(dir, manifest), 'assets/shared/sounds')),
    ).toHaveLength(32);
  });

  it('writes past a .partial left by a crashed run', async () => {
    const dir = await cache();
    const fonts = join(commitDir(dir, MANIFEST), 'assets/shared/fonts');
    await mkdir(fonts, { recursive: true });
    await writeFile(join(fonts, 'busy_tiny.font.partial'), 'half a fo');
    const fetch = serving({
      'assets/shared/fonts/busy_tiny.font': FONT,
      'assets/shared/sounds/beep.wav': SOUND,
    });

    await syncAssets({ manifest: MANIFEST, cacheDir: dir, fetch });

    expect(await readFile(join(fonts, 'busy_tiny.font'))).toStrictEqual(
      Buffer.from(FONT),
    );
  });

  it('reports a file it cannot save', async () => {
    const dir = await cache();
    // A folder where the font should go: the rename over it fails.
    const font = join(
      commitDir(dir, MANIFEST),
      'assets/shared/fonts/busy_tiny.font',
    );
    await mkdir(join(font, 'taken'), { recursive: true });
    const fetch = serving({
      'assets/shared/fonts/busy_tiny.font': FONT,
      'assets/shared/sounds/beep.wav': SOUND,
    });

    const failure = syncAssets({ manifest: MANIFEST, cacheDir: dir, fetch });

    await expect(failure).rejects.toThrow(
      new AssetSyncError('Could not save assets/shared/fonts/busy_tiny.font.'),
    );
    await expect(failure).rejects.toHaveProperty(
      'cause.code',
      expect.any(String),
    );
    expect(await readdir(join(font, '..'))).toStrictEqual(['busy_tiny.font']);
  });
});
