/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api.js';
import { ANSWER_SHOWN_MS, KNOCK_WAIT_MS } from './knocks.ts';
import type { Presence } from './presence.ts';
import schema from './schema.ts';

// The files Convex itself loads: modules whose names have one dot, which
// leaves out tests and declaration files.
const modules = import.meta.glob(['./**/*.*s', '!./**/*.*.*s']);

const FREE: Presence = { state: 'free' };

afterEach(() => {
  vi.useRealTimers();
});

/** A team whose bars all report free, unless told otherwise. */
async function team(
  names: readonly string[],
  presence: Readonly<Record<string, Presence | 'offline'>> = {},
) {
  const t = convexTest(schema, modules);
  const keys: Record<string, string> = {};
  for (const name of names) {
    const { key } = await t.mutation(internal.bars.add, { name });
    keys[name] = key;
    const reported = presence[name] ?? FREE;
    if (reported !== 'offline') {
      await t.mutation(api.bars.report, { key, presence: reported });
    }
  }
  const keyOf = (name: string): string => {
    const key = keys[name];
    if (key === undefined) {
      throw new Error(`${name} is not on the team.`);
    }
    return key;
  };
  const board = async (name: string) =>
    await t.query(api.team.board, { key: keyOf(name) });
  const idOf = async (name: string): Promise<string> => {
    const [first] = names;
    const found = (await board(first ?? name)).bars.find(
      (bar) => bar.name === name,
    );
    if (found === undefined) {
      throw new Error(`${name} has no row.`);
    }
    return found.id;
  };
  /** The knocks `name`'s board shows, by who knocked on whom. */
  const knocks = async (name: string) => {
    const { bars, knocks: shown } = await board(name);
    const nameOf = (id: string) => bars.find((bar) => bar.id === id)?.name;
    return shown.map(({ from, to, status }) => ({
      from: nameOf(from),
      to: nameOf(to),
      status,
    }));
  };
  const knock = async (from: string, to: string) => {
    await t.mutation(api.knocks.send, { key: keyOf(from), to: await idOf(to) });
  };
  const waiting = async (name: string): Promise<string> => {
    const found = (await board(name)).knocks.find(
      (shown) => shown.status === 'waiting',
    );
    if (found === undefined) {
      throw new Error(`No knock waits on ${name}.`);
    }
    return found.id;
  };
  return { t, keyOf, idOf, knocks, knock, waiting };
}

describe('knocks:send', () => {
  it('knocks on a free teammate, and both bars see the knock', async () => {
    const { knock, knocks } = await team(['Anna', 'Ben', 'Cleo']);

    await knock('Anna', 'Ben');

    const expected = [{ from: 'Anna', to: 'Ben', status: 'waiting' }];
    expect(await knocks('Anna')).toStrictEqual(expected);
    expect(await knocks('Ben')).toStrictEqual(expected);
    expect(await knocks('Cleo')).toStrictEqual([]);
  });

  it('refuses a teammate who is busy, paused, or offline', async () => {
    const { knock } = await team(['Anna', 'Ben', 'Cleo', 'Dan'], {
      Ben: { state: 'busy', endsAt: Date.now() + 60_000 },
      Cleo: { state: 'paused', leftMs: 60_000 },
      Dan: 'offline',
    });

    for (const name of ['Ben', 'Cleo', 'Dan']) {
      await expect(knock('Anna', name)).rejects.toThrow(
        `${name} cannot take a knock now.`,
      );
    }
  });

  it('knocks on a teammate whose timer has run out', async () => {
    const { knock, knocks } = await team(['Anna', 'Ben'], {
      Ben: { state: 'busy', endsAt: Date.now() - 1 },
    });

    await knock('Anna', 'Ben');

    expect(await knocks('Ben')).toHaveLength(1);
  });

  it('refuses its own bar and an id that names no bar', async () => {
    const { t, keyOf, knock, waiting } = await team(['Anna', 'Ben']);
    await knock('Ben', 'Anna');

    await expect(knock('Anna', 'Anna')).rejects.toThrow(
      'There is no other bar with that id.',
    );
    for (const to of ['nope', await waiting('Anna')]) {
      await expect(
        t.mutation(api.knocks.send, { key: keyOf('Anna'), to }),
      ).rejects.toThrow('There is no other bar with that id.');
    }
  });

  it('replaces the last knock a bar sent', async () => {
    const { knock, knocks } = await team(['Anna', 'Ben', 'Cleo']);
    await knock('Anna', 'Ben');

    await knock('Anna', 'Cleo');

    expect(await knocks('Anna')).toStrictEqual([
      { from: 'Anna', to: 'Cleo', status: 'waiting' },
    ]);
    expect(await knocks('Ben')).toStrictEqual([]);
  });
});

describe('knocks:answer', () => {
  it('answers, and the answer shows on the knocking bar for a while', async () => {
    vi.useFakeTimers();
    const { t, keyOf, knock, knocks, waiting } = await team(['Anna', 'Ben']);
    await knock('Anna', 'Ben');

    await t.mutation(api.knocks.answer, {
      key: keyOf('Ben'),
      knock: await waiting('Ben'),
      reply: 'coming',
    });

    expect(await knocks('Anna')).toStrictEqual([
      { from: 'Anna', to: 'Ben', status: 'coming' },
    ]);

    vi.advanceTimersByTime(ANSWER_SHOWN_MS);
    await t.finishInProgressScheduledFunctions();

    expect(await knocks('Anna')).toStrictEqual([]);
  });

  it('leaves a knock that is answered or gone as it is', async () => {
    const { t, keyOf, knock, knocks, waiting } = await team(['Anna', 'Ben']);
    await knock('Anna', 'Ben');
    const id = await waiting('Ben');
    await t.mutation(api.knocks.answer, {
      key: keyOf('Ben'),
      knock: id,
      reply: 'later',
    });

    for (const knockId of [id, 'nope']) {
      await t.mutation(api.knocks.answer, {
        key: keyOf('Ben'),
        knock: knockId,
        reply: 'coming',
      });
    }

    expect(await knocks('Anna')).toStrictEqual([
      { from: 'Anna', to: 'Ben', status: 'later' },
    ]);
  });

  it('refuses to answer for another bar', async () => {
    const { t, keyOf, knock, waiting } = await team(['Anna', 'Ben', 'Cleo']);
    await knock('Anna', 'Ben');

    await expect(
      t.mutation(api.knocks.answer, {
        key: keyOf('Cleo'),
        knock: await waiting('Ben'),
        reply: 'coming',
      }),
    ).rejects.toThrow('That knock is for another bar.');
  });
});

describe('knocks:expire', () => {
  it('expires a knock nobody answered, then forgets it', async () => {
    vi.useFakeTimers();
    const { t, knock, knocks } = await team(['Anna', 'Ben']);
    await knock('Anna', 'Ben');

    vi.advanceTimersByTime(KNOCK_WAIT_MS);
    await t.finishInProgressScheduledFunctions();

    expect(await knocks('Anna')).toStrictEqual([
      { from: 'Anna', to: 'Ben', status: 'expired' },
    ]);

    vi.advanceTimersByTime(ANSWER_SHOWN_MS);
    await t.finishInProgressScheduledFunctions();

    expect(await knocks('Anna')).toStrictEqual([]);
  });

  it('leaves an answered knock alone', async () => {
    const { t, keyOf, knock, knocks, waiting } = await team(['Anna', 'Ben']);
    await knock('Anna', 'Ben');
    const id = await waiting('Ben');
    await t.mutation(api.knocks.answer, {
      key: keyOf('Ben'),
      knock: id,
      reply: 'later',
    });
    const knockId = await t.run(
      async (ctx) => (await ctx.db.query('knocks').first())?._id,
    );
    if (knockId === undefined) {
      throw new Error('The knock is gone.');
    }

    await t.mutation(internal.knocks.expire, { knock: knockId });
    await t.mutation(internal.knocks.forget, { knock: knockId });
    await t.mutation(internal.knocks.forget, { knock: knockId });

    expect(await knocks('Anna')).toStrictEqual([]);
  });
});

describe('bars:remove', () => {
  it('drops the knocks to and from the bar', async () => {
    const { t, knock, knocks } = await team(['Anna', 'Ben', 'Cleo']);
    await knock('Anna', 'Ben');
    await knock('Ben', 'Cleo');

    await t.mutation(internal.bars.remove, { name: 'Ben' });

    expect(await knocks('Anna')).toStrictEqual([]);
    expect(await knocks('Cleo')).toStrictEqual([]);
  });
});
