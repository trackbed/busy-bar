// What every bar subscribes to: the team and what each bar last reported.

import { v } from 'convex/values';

import { query } from './_generated/server.js';
import { requireBar } from './keys.ts';
import { knocksFrom, knocksTo } from './knocks.ts';
import { knockStatusValidator, presenceValidator } from './presence.ts';

/** The most bars a team holds; the board shows them all at once. */
export const MAX_BARS = 20;

/**
 * Every bar on the team by name, which one is asking, the knocks to and from
 * it, oldest first, and the team focus, if one is starting or running. Only
 * a bar's row, one of its knocks, or the focus changing re-runs it, so
 * heartbeats cost the subscribers nothing.
 */
export const board = query({
  args: { key: v.string() },
  returns: v.object({
    me: v.id('bars'),
    bars: v.array(
      v.object({
        id: v.id('bars'),
        name: v.string(),
        online: v.boolean(),
        presence: presenceValidator,
      }),
    ),
    knocks: v.array(
      v.object({
        id: v.id('knocks'),
        from: v.id('bars'),
        to: v.id('bars'),
        status: knockStatusValidator,
      }),
    ),
    focus: v.union(
      v.null(),
      v.object({
        id: v.id('focusSessions'),
        startedBy: v.id('bars'),
        startsAt: v.number(),
        endsAt: v.number(),
        cardId: v.string(),
        skipped: v.array(v.id('bars')),
      }),
    ),
  }),
  handler: async (ctx, { key }) => {
    const me = await requireBar(ctx, key);
    const bars = await ctx.db.query('bars').withIndex('by_name').take(MAX_BARS);
    const knocks = [
      ...(await knocksTo(ctx, me._id)),
      ...(await knocksFrom(ctx, me._id)),
    ].sort((a, b) => a._creationTime - b._creationTime);
    const focus = await ctx.db.query('focusSessions').first();
    return {
      me: me._id,
      bars: bars.map(({ _id, name, online, presence }) => ({
        id: _id,
        name,
        online,
        presence,
      })),
      knocks: knocks.map(({ _id, from, to, status }) => ({
        id: _id,
        from,
        to,
        status,
      })),
      focus:
        focus === null
          ? null
          : {
              id: focus._id,
              startedBy: focus.startedBy,
              startsAt: focus.startsAt,
              endsAt: focus.endsAt,
              cardId: focus.cardId,
              skipped: focus.skipped,
            },
    };
  },
});
