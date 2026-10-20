import { describe, expect, it } from 'vitest';

import { zip } from '../__tests__/fixtures.ts';
import { readZip, ZipError } from './zip.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('readZip', () => {
  it('reads stored and deflated files, skipping folders and macOS metadata', () => {
    const entries = readZip(
      zip([
        { name: 'coding_72x16/', data: new Uint8Array(0), method: 0 },
        { name: 'coding_72x16/meta.json', data: text('{"fps":30}') },
        {
          name: 'coding_72x16/frame_0.png',
          data: Uint8Array.from([1, 2, 3]),
          method: 0,
        },
        { name: '__MACOSX/coding_72x16/._frame_0.png', data: text('junk') },
      ]),
    );

    expect(entries.map((entry) => entry.name)).toStrictEqual([
      'coding_72x16/meta.json',
      'coding_72x16/frame_0.png',
    ]);
    expect(new TextDecoder().decode(entries[0]?.data)).toBe('{"fps":30}');
    expect(entries[1]?.data).toStrictEqual(Uint8Array.from([1, 2, 3]));
  });

  it('finds the directory past a trailing comment', () => {
    const archive = zip([{ name: 'a.txt', data: text('hi') }]);
    const withComment = new Uint8Array(archive.length + 5);
    withComment.set(archive);
    new DataView(withComment.buffer).setUint16(archive.length - 2, 5, true);

    expect(readZip(withComment)).toHaveLength(1);
  });

  it.each([
    [new Uint8Array(40), 'Not a ZIP archive.'],
    [
      zip([{ name: 'secret.txt', data: text('x'), flags: 1 }]),
      'secret.txt is encrypted.',
    ],
    [
      zip([{ name: 'odd.bin', data: text('x'), method: 12 }]),
      'compression method 12',
    ],
    [
      zip([{ name: 'short.txt', data: text('hello'), sizeOverride: 4 }]),
      'inflated to 5 bytes instead of 4',
    ],
  ])('rejects archives it cannot read (%#)', (bytes, message) => {
    expect(() => readZip(bytes)).toThrow(ZipError);
    expect(() => readZip(bytes)).toThrow(message);
  });

  it('rejects a corrupt directory, local header, or body', () => {
    const archive = zip([{ name: 'a.txt', data: text('hello world') }]);
    const view = new DataView(archive.buffer);
    const directoryAt = view.getUint32(archive.length - 6, true);

    const badDirectory = archive.slice();
    new DataView(badDirectory.buffer).setUint32(directoryAt, 0, true);
    expect(() => readZip(badDirectory)).toThrow('directory is corrupt');

    const badLocal = archive.slice();
    new DataView(badLocal.buffer).setUint32(0, 0, true);
    expect(() => readZip(badLocal)).toThrow('no local header');

    const badBody = archive.slice();
    badBody.set([0xff, 0xff, 0xff, 0xff], 31 + 'a.txt'.length - 1);
    expect(() => readZip(badBody)).toThrow(ZipError);

    const truncated = archive.slice();
    new DataView(truncated.buffer).setUint32(directoryAt + 20, 9999, true);
    expect(() => readZip(truncated)).toThrow('truncated');
  });
});
