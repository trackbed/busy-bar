// Knocks: one bar asks another for a minute, and the other answers with OK
// (coming) or BACK (later). Only a free bar takes a knock, since a bar whose
// BUSY timer works, rests, or is paused refuses every draw.

import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api.js';
import type { Doc, Id } from './_generated/dataModel.js';
import type { QueryCtx } from './_generated/server.js';
import { internalMutation, mutation } from './_generated/server.js';
import { requireBar } from './keys.ts';
import { freeAt } from './presence.ts';

/** How long a knock waits for an answer. */
export const KNOCK_WAIT_MS = 2 * 60_000;

/** How long an answer, or its absence, stays on the knocking bar. */
export const ANSWER_SHOWN_MS = 60_000;

/**
 * Knock on the bar `to`. A bar has one knock out at a time, so a new one
 * replaces the last. Ids arrive as strings and are checked here.
 */
export const send = mutation({
  args: { key: v.string(), to: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const from = await requireBar(ctx, args.key);
    const to = ctx.db.normalizeId('bars', args.to);
    const target = to === null ? null : await ctx.db.get(to);
    if (target === null || target._id === from._id) {
      throw new ConvexError('There is no other bar with that id.');
    }
    if (!target.online || !freeAt(target.presence, Date.now())) {
      throw new ConvexError(`${target.name} cannot take a knock now.`);
    }
    for (const old of await knocksFrom(ctx, from._id)) {
      await ctx.db.delete(old._id);
    }
    const knock = await ctx.db.insert('knocks', {
      from: from._id,
      to: target._id,
      status: 'waiting',
    });
    await ctx.scheduler.runAfter(KNOCK_WAIT_MS, internal.knocks.expire, {
      knock,
    });
    return null;
  },
});

/**
 * Answer a knock on this bar. A knock that expired, was replaced, or was
 * answered already is left as it is.
 */
export const answer = mutation({
  args: {
    key: v.string(),
    knock: v.string(),
    reply: v.union(v.literal('coming'), v.literal('later')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const me = await requireBar(ctx, args.key);
    const id = ctx.db.normalizeId('knocks', args.knock);
    const knock = id === null ? null : await ctx.db.get(id);
    if (knock?.status !== 'waiting') {
      return null;
    }
    if (knock.to !== me._id) {
      throw new ConvexError('That knock is for another bar.');
    }
    await ctx.db.patch(knock._id, { status: args.reply });
    await ctx.scheduler.runAfter(ANSWER_SHOWN_MS, internal.knocks.forget, {
      knock: knock._id,
    });
    return null;
  },
});

/** A knock nobody answered in time. */
export const expire = internalMutation({
  args: { knock: v.id('knocks') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const knock = await ctx.db.get(args.knock);
    if (knock?.status === 'waiting') {
      await ctx.db.patch(knock._id, { status: 'expired' });
      await ctx.scheduler.runAfter(ANSWER_SHOWN_MS, internal.knocks.forget, {
        knock: knock._id,
      });
    }
    return null;
  },
});

/** Drop an answered or expired knock once the knocking bar has shown it. */
export const forget = internalMutation({
  args: { knock: v.id('knocks') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if ((await ctx.db.get(args.knock)) !== null) {
      await ctx.db.delete(args.knock);
    }
    return null;
  },
});

/** The knocks `bar` sent: one at most, since a new knock replaces it. */
export async function knocksFrom(
  ctx: Pick<QueryCtx, 'db'>,
  bar: Id<'bars'>,
): Promise<Doc<'knocks'>[]> {
  return await ctx.db
    .query('knocks')
    .withIndex('by_from', (q) => q.eq('from', bar))
    .collect();
}

/** The knocks sent to `bar`, oldest first: one at most from each bar. */
export async function knocksTo(
  ctx: Pick<QueryCtx, 'db'>,
  bar: Id<'bars'>,
): Promise<Doc<'knocks'>[]> {
  return await ctx.db
    .query('knocks')
    .withIndex('by_to', (q) => q.eq('to', bar))
    .collect();
}
