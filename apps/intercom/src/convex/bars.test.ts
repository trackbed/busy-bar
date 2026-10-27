/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api.js';
import { UNKNOWN_KEY } from './keys.ts';
import type { Presence } from './presence.ts';
import { HEARTBEAT_MS, OFFLINE_AFTER_MS } from './presence.ts';
import schema from './schema.ts';
import { MAX_BARS } from './team.ts';

// The files Convex itself loads: modules whose names have one dot, which
// leaves out tests and declaration files.
const modules = import.meta.glob(['./**/*.*s', '!./**/*.*.*s']);

const BUSY: Presence = { state: 'busy', endsAt: 1_761_480_000_000 };

afterEach(() => {
  vi.useRealTimers();
});

async function team(...names: string[]) {
  const t = convexTest(schema, modules);
  const keys: string[] = [];
  for (const name of names) {
    keys.push((await t.mutation(internal.bars.add, { name })).key);
  }
  return { t, keys };
}

async function presenceOf(
  t: Awaited<ReturnType<typeof team>>['t'],
  key: string,
) {
  const board = await t.query(api.team.board, { key });
  return board.bars.find((bar) => bar.id === board.me);
}

describe('bars:add', () => {
  it('answers the key a new bar signs in with', async () => {
    const t = convexTest(schema, modules);

    const added = await t.mutation(internal.bars.add, { name: ' Anna ' });

    expect(added.name).toBe('Anna');
    expect(added.key).toMatch(/^[\da-f]{48}$/u);
    expect(await presenceOf(t, added.key)).toMatchObject({
      name: 'Anna',
      online: false,
      presence: { state: 'free' },
    });
  });

  it('stores only a hash of the key', async () => {
    const { t, keys } = await team('Anna');

    const [row] = await t.run(
      async (ctx) => await ctx.db.query('bars').collect(),
    );

    expect(row?.keyHash).toMatch(/^[\da-f]{64}$/u);
    expect(row?.keyHash).not.toContain(keys[0]);
  });

  it('refuses a name the fonts cannot draw or the rows cannot hold', async () => {
    const t = convexTest(schema, modules);

    for (const name of ['', '   ', 'Søren', 'Thirteen char']) {
      await expect(t.mutation(internal.bars.add, { name })).rejects.toThrow(
        'A bar name is 1 to 12 printable ASCII characters.',
      );
    }
  });

  it('refuses a second bar with the same name', async () => {
    const { t } = await team('Anna');

    await expect(
      t.mutation(internal.bars.add, { name: 'Anna' }),
    ).rejects.toThrow('There already is a bar named Anna.');
  });

  it(`holds at most ${MAX_BARS} bars`, async () => {
    const { t } = await team(
      ...Array.from({ length: MAX_BARS }, (_, index) => `Bar ${index}`),
    );

    await expect(
      t.mutation(internal.bars.add, { name: 'One more' }),
    ).rejects.toThrow(`A team holds at most ${MAX_BARS} bars.`);
  });
});

describe('bars:remove', () => {
  it('retires the bar and its key', async () => {
    const { t, keys } = await team('Anna', 'Ben');
    const [anna = '', ben = ''] = keys;
    await t.mutation(api.bars.report, { key: anna, presence: BUSY });

    await t.mutation(internal.bars.remove, { name: 'Anna' });

    await expect(
      t.mutation(api.bars.report, { key: anna, presence: BUSY }),
    ).rejects.toThrow(UNKNOWN_KEY);
    expect(
      (await t.query(api.team.board, { key: ben })).bars.map((bar) => bar.name),
    ).toStrictEqual(['Ben']);
    expect(
      await t.run(async (ctx) => await ctx.db.query('heartbeats').collect()),
    ).toStrictEqual([]);
  });

  it('refuses a bar that is not there', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.bars.remove, { name: 'Anna' }),
    ).rejects.toThrow('There is no bar named Anna.');
  });
});

describe('bars:report', () => {
  it('puts the bar online with what its timer says', async () => {
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;

    await t.mutation(api.bars.report, { key, presence: BUSY });

    expect(await presenceOf(t, key)).toMatchObject({
      online: true,
      presence: BUSY,
    });
  });

  it('refuses a key it does not know', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.bars.report, { key: 'nope', presence: BUSY }),
    ).rejects.toThrow(UNKNOWN_KEY);
  });

  it('takes a bar offline once it stops reporting', async () => {
    vi.useFakeTimers();
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;
    await t.mutation(api.bars.report, { key, presence: BUSY });

    vi.advanceTimersByTime(OFFLINE_AFTER_MS);
    await t.finishInProgressScheduledFunctions();

    expect(await presenceOf(t, key)).toMatchObject({
      online: false,
      presence: BUSY,
    });
  });

  it('keeps a bar that goes on reporting online', async () => {
    vi.useFakeTimers();
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;
    await t.mutation(api.bars.report, { key, presence: BUSY });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await t.mutation(api.bars.report, { key, presence: BUSY });

    // Past the first report's expiry, which the second one cancelled.
    vi.advanceTimersByTime(OFFLINE_AFTER_MS - HEARTBEAT_MS + 1);
    await t.finishInProgressScheduledFunctions();

    expect(await presenceOf(t, key)).toMatchObject({ online: true });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).map(
          (job) => job.state.kind,
        ),
      ),
    ).toStrictEqual(['canceled', 'pending']);
  });

  it('ignores an expiry that a newer report overtook', async () => {
    vi.useFakeTimers();
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;
    await t.mutation(api.bars.report, { key, presence: BUSY });
    const bar = (await presenceOf(t, key))?.id;
    if (bar === undefined) {
      throw new Error('Anna is not on the board.');
    }

    vi.advanceTimersByTime(HEARTBEAT_MS);
    await t.mutation(internal.bars.expire, { bar });

    expect(await presenceOf(t, key)).toMatchObject({ online: true });
  });
});

describe('bars:leave', () => {
  it('shows the bar offline at once', async () => {
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;
    await t.mutation(api.bars.report, { key, presence: BUSY });

    await t.mutation(api.bars.leave, { key });

    expect(await presenceOf(t, key)).toMatchObject({ online: false });
    expect(
      await t.run(async (ctx) => ({
        heartbeats: await ctx.db.query('heartbeats').collect(),
        jobs: (await ctx.db.system.query('_scheduled_functions').collect()).map(
          (job) => job.state.kind,
        ),
      })),
    ).toStrictEqual({ heartbeats: [], jobs: ['canceled'] });
  });

  it('leaves an offline bar as it is', async () => {
    const { t, keys } = await team('Anna');
    const [key = ''] = keys;

    await t.mutation(api.bars.leave, { key });

    expect(await presenceOf(t, key)).toMatchObject({ online: false });
  });
});
