/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api.js';
import { FOCUS_LEAD_MS } from './focus.ts';
import schema from './schema.ts';

// The files Convex itself loads: modules whose names have one dot, which
// leaves out tests and declaration files.
const modules = import.meta.glob(['./**/*.*s', '!./**/*.*.*s']);

const NOW = Date.parse('2026-10-27T09:00:00Z');
const MINUTE = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

async function team(...names: string[]) {
  vi.useFakeTimers({ now: NOW });
  const t = convexTest(schema, modules);
  const keys = new Map<string, string>();
  for (const name of names) {
    keys.set(name, (await t.mutation(internal.bars.add, { name })).key);
  }
  const key = (name: string): string => keys.get(name) ?? '';
  const board = async (name: string) =>
    await t.query(api.team.board, { key: key(name) });
  const id = async (name: string): Promise<string> =>
    (await board(names[0] ?? name)).bars.find((bar) => bar.name === name)?.id ??
    '';
  const focus = async (name: string) => (await board(name)).focus;
  return { t, key, id, focus };
}

describe('focus:start', () => {
  it('starts a session every bar sees, after the lead time', async () => {
    const { t, key, id, focus } = await team('Anna', 'Ben');

    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 25 });

    const shown = await focus('Ben');
    expect(shown).toMatchObject({
      startedBy: await id('Anna'),
      startsAt: NOW + FOCUS_LEAD_MS,
      endsAt: NOW + FOCUS_LEAD_MS + 25 * MINUTE,
      skipped: [],
    });
    expect(shown?.cardId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
    );
    expect(await focus('Anna')).toStrictEqual(shown);
  });

  it.each([4, 1441, 2.5, Number.NaN])(
    'refuses a session of %s minutes',
    async (minutes) => {
      const { t, key } = await team('Anna');

      await expect(
        t.mutation(api.focus.start, { key: key('Anna'), minutes }),
      ).rejects.toThrow('A team focus lasts 5 to 1440 minutes.');
    },
  );

  it('runs one session at a time, then drops it when it ends', async () => {
    const { t, key, focus } = await team('Anna', 'Ben');
    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 5 });

    await expect(
      t.mutation(api.focus.start, { key: key('Ben'), minutes: 5 }),
    ).rejects.toThrow('A team focus is on already.');

    vi.advanceTimersByTime(FOCUS_LEAD_MS + 5 * MINUTE);
    await t.finishInProgressScheduledFunctions();

    expect(await focus('Ben')).toBeNull();
    await t.mutation(api.focus.start, { key: key('Ben'), minutes: 5 });
    expect(await focus('Ben')).not.toBeNull();
  });

  it('replaces a session whose end has passed but not yet run', async () => {
    const { t, key, id, focus } = await team('Anna', 'Ben');
    const anna = await id('Anna');
    await t.run(async (ctx) => {
      const startedBy = ctx.db.normalizeId('bars', anna);
      if (startedBy === null) {
        throw new Error('Anna has no id.');
      }
      await ctx.db.insert('focusSessions', {
        startedBy,
        startsAt: NOW - 30 * MINUTE,
        endsAt: NOW - MINUTE,
        cardId: '00000000-0000-0000-0000-000000000000',
        skipped: [],
      });
    });

    await t.mutation(api.focus.start, { key: key('Ben'), minutes: 5 });

    expect((await focus('Anna'))?.startsAt).toBe(NOW + FOCUS_LEAD_MS);
  });
});

describe('focus:skip', () => {
  it('leaves a bar out, once, until the timers start', async () => {
    const { t, key, id, focus } = await team('Anna', 'Ben');
    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 25 });
    const session = (await focus('Ben'))?.id ?? '';

    await t.mutation(api.focus.skip, { key: key('Ben'), focus: session });
    await t.mutation(api.focus.skip, { key: key('Ben'), focus: session });

    expect((await focus('Anna'))?.skipped).toStrictEqual([await id('Ben')]);
  });

  it('lets the starting bar call the session off for everyone', async () => {
    const { t, key, focus } = await team('Anna', 'Ben');
    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 25 });
    const session = (await focus('Ben'))?.id ?? '';

    await t.mutation(api.focus.skip, { key: key('Anna'), focus: session });

    expect(await focus('Ben')).toBeNull();
  });

  it('does nothing once the timers run, or for a session that is gone', async () => {
    const { t, key, focus } = await team('Anna', 'Ben');
    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 25 });
    const session = (await focus('Ben'))?.id ?? '';
    vi.advanceTimersByTime(FOCUS_LEAD_MS);

    await t.mutation(api.focus.skip, { key: key('Anna'), focus: session });
    await t.mutation(api.focus.skip, { key: key('Ben'), focus: session });
    await t.mutation(api.focus.skip, { key: key('Ben'), focus: 'nope' });

    expect(await focus('Ben')).toMatchObject({ skipped: [] });
  });
});

describe('focus:end', () => {
  it('drops a session, and shrugs at one already gone', async () => {
    const { t, key, focus } = await team('Anna');
    await t.mutation(api.focus.start, { key: key('Anna'), minutes: 25 });
    const id = await t.run(
      async (ctx) => (await ctx.db.query('focusSessions').first())?._id,
    );
    if (id === undefined) {
      throw new Error('No session.');
    }

    await t.mutation(internal.focus.end, { focus: id });
    await t.mutation(internal.focus.end, { focus: id });

    expect(await focus('Anna')).toBeNull();
  });
});
