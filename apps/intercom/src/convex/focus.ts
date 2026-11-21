// Team focus: one bar starts a session, and every bar that does not skip it
// runs its BUSY timer from the same snapshot, so they all end together.
// Convex only records the session; each bar's process starts its own timer.

import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api.js';
import { internalMutation, mutation } from './_generated/server.js';
import { requireBar } from './keys.ts';
import { FOCUS_LEAD_MS, FOCUS_MINUTES } from './presence.ts';

/**
 * Start a team focus of `minutes`, after {@link FOCUS_LEAD_MS}. One runs at a
 * time, for the whole team.
 */
export const start = mutation({
  args: { key: v.string(), minutes: v.number() },
  returns: v.null(),
  handler: async (ctx, { key, minutes }): Promise<null> => {
    const me = await requireBar(ctx, key);
    if (
      !Number.isInteger(minutes) ||
      minutes < FOCUS_MINUTES.min ||
      minutes > FOCUS_MINUTES.max
    ) {
      throw new ConvexError(
        `A team focus lasts ${FOCUS_MINUTES.min} to ${FOCUS_MINUTES.max} minutes.`,
      );
    }
    const now = Date.now();
    const current = await ctx.db.query('focusSessions').first();
    if (current !== null) {
      if (current.endsAt > now) {
        throw new ConvexError('A team focus is on already.');
      }
      // Its end has passed, and the call that drops it has yet to run.
      await ctx.db.delete(current._id);
    }
    const startsAt = now + FOCUS_LEAD_MS;
    const endsAt = startsAt + minutes * 60_000;
    const focus = await ctx.db.insert('focusSessions', {
      startedBy: me._id,
      startsAt,
      endsAt,
      cardId: crypto.randomUUID(),
      skipped: [],
    });
    await ctx.scheduler.runAt(endsAt, internal.focus.end, { focus });
    return null;
  },
});

/**
 * Leave a team focus before it starts. The bar that started it calls it off
 * for everyone. Once the timers run, each bar's own is its owner's to stop.
 */
export const skip = mutation({
  args: { key: v.string(), focus: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const me = await requireBar(ctx, args.key);
    const id = ctx.db.normalizeId('focusSessions', args.focus);
    const focus = id === null ? null : await ctx.db.get(id);
    if (focus === null || focus.startsAt <= Date.now()) {
      return null;
    }
    if (focus.startedBy === me._id) {
      await ctx.db.delete(focus._id);
    } else if (!focus.skipped.includes(me._id)) {
      await ctx.db.patch(focus._id, { skipped: [...focus.skipped, me._id] });
    }
    return null;
  },
});

/** Drop a team focus once its timers have run out. */
export const end = internalMutation({
  args: { focus: v.id('focusSessions') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if ((await ctx.db.get(args.focus)) !== null) {
      await ctx.db.delete(args.focus);
    }
    return null;
  },
});
