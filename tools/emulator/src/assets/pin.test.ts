import { describe, expect, it } from 'vitest';

import manifest from './firmware-assets.json' with { type: 'json' };
import { FIRMWARE_REPOSITORY, manifestFromTree, parseTree } from './pin.ts';

describe('manifestFromTree', () => {
  it('keeps the fonts, stock media, and licences, sorted by path', () => {
    const tree = [
      {
        path: 'assets/shared/sounds/beep.wav',
        type: 'blob',
        sha: 'b',
        size: 3,
      },
      {
        path: 'assets/shared/fonts/busy_tiny.font',
        type: 'blob',
        sha: 'a',
        size: 2,
      },
      { path: 'assets/shared/fonts', type: 'tree', sha: 't' },
      {
        path: 'assets/shared/fonts/ttf/busy_tiny.ttf',
        type: 'blob',
        sha: 'x',
        size: 9,
      },
      {
        path: 'assets/shared/images/external/check_8x8.png',
        type: 'blob',
        sha: 'c',
        size: 4,
      },
      {
        path: 'assets/images/external/busy/bar_8x8.png',
        type: 'blob',
        sha: 'd',
      },
      {
        path: 'assets/images/external/wifi_settings/wifi.png',
        type: 'blob',
        sha: 'y',
        size: 9,
      },
      {
        path: 'assets/animations/busy/flow_72x16.zip',
        type: 'blob',
        sha: 'e',
        size: 5,
      },
      {
        path: 'assets/animations/power_on/boot.zip',
        type: 'blob',
        sha: 'z',
        size: 9,
      },
      { path: 'LICENSES/OFL-1.1.txt', type: 'blob', sha: 'f', size: 6 },
      {
        path: 'LICENSES/GPL-2.0-or-later.txt',
        type: 'blob',
        sha: 'g',
        size: 9,
      },
    ];

    expect(manifestFromTree('c0ffee', tree)).toStrictEqual({
      repository: FIRMWARE_REPOSITORY,
      commit: 'c0ffee',
      files: [
        { path: 'assets/shared/fonts/busy_tiny.font', sha: 'a', size: 2 },
        {
          path: 'assets/shared/images/external/check_8x8.png',
          sha: 'c',
          size: 4,
        },
        { path: 'assets/shared/sounds/beep.wav', sha: 'b', size: 3 },
        { path: 'LICENSES/OFL-1.1.txt', sha: 'f', size: 6 },
      ],
    });
  });

  it('pins the committed manifest to one full commit', () => {
    expect(manifest.repository).toBe(FIRMWARE_REPOSITORY);
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(manifest.files.length).toBeGreaterThan(100);
    expect(
      manifest.files.every((file) => /^[0-9a-f]{40}$/u.test(file.sha)),
    ).toBe(true);
  });
});

describe('parseTree', () => {
  it('keeps well-formed entries and reports truncation', () => {
    expect(
      parseTree({
        truncated: true,
        tree: [
          { path: 'a', type: 'blob', sha: '1', size: 2 },
          { path: 'b', type: 'tree', sha: '2' },
          { path: 3, type: 'blob', sha: '3' },
          'junk',
          null,
        ],
      }),
    ).toStrictEqual({
      truncated: true,
      entries: [
        { path: 'a', type: 'blob', sha: '1', size: 2 },
        { path: 'b', type: 'tree', sha: '2' },
      ],
    });
  });

  it('rejects an answer without a tree', () => {
    expect(() => parseTree({ message: 'Not Found' })).toThrow(
      'GitHub sent no tree.',
    );
    expect(() => parseTree(null)).toThrow('GitHub sent no tree.');
  });
});
