/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from './_generated/api.js';
import { UNKNOWN_KEY } from './keys.ts';
import schema from './schema.ts';

// The files Convex itself loads: modules whose names have one dot, which
// leaves out tests and declaration files.
const modules = import.meta.glob(['./**/*.*s', '!./**/*.*.*s']);

describe('team:board', () => {
  it('lists every bar by name and says which one is asking', async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.bars.add, { name: 'Cleo' });
    await t.mutation(internal.bars.add, { name: 'Anna' });
    await t.mutation(internal.bars.add, { name: 'Ben' });

    const board = await t.query(api.team.board, { key });

    expect(board.bars.map((bar) => bar.name)).toStrictEqual([
      'Anna',
      'Ben',
      'Cleo',
    ]);
    expect(board.bars.find((bar) => bar.id === board.me)?.name).toBe('Cleo');
  });

  it('shows nothing to an unknown key', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.bars.add, { name: 'Anna' });

    await expect(t.query(api.team.board, { key: 'not-a-key' })).rejects.toThrow(
      UNKNOWN_KEY,
    );
  });

  it('lists the knocks to and from the bar, oldest first', async () => {
    const t = convexTest(schema, modules);
    const keys: Record<string, string> = {};
    for (const name of ['Anna', 'Ben', 'Cleo', 'Dan']) {
      const { key } = await t.mutation(internal.bars.add, { name });
      await t.mutation(api.bars.report, { key, presence: { state: 'free' } });
      keys[name] = key;
    }
    const key = (name: string): string => keys[name] ?? '';
    const before = await t.query(api.team.board, { key: key('Ben') });
    const id = (name: string): string =>
      before.bars.find((bar) => bar.name === name)?.id ?? '';
    await t.mutation(api.knocks.send, { key: key('Anna'), to: id('Ben') });
    await t.mutation(api.knocks.send, { key: key('Ben'), to: id('Cleo') });
    await t.mutation(api.knocks.send, { key: key('Dan'), to: id('Ben') });

    const { knocks } = await t.query(api.team.board, { key: key('Ben') });

    expect(knocks.map(({ from, to }) => [from, to])).toStrictEqual([
      [id('Anna'), id('Ben')],
      [id('Ben'), id('Cleo')],
      [id('Dan'), id('Ben')],
    ]);
  });
});
