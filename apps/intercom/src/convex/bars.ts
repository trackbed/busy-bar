// The bars on the team: the deployment owner adds and removes them with
// `convex run`, and each bar's process reports its presence.

import { ConvexError, v } from 'convex/values';

import { internal } from './_generated/api.js';
import type { Id } from './_generated/dataModel.js';
import type { MutationCtx } from './_generated/server.js';
import { internalMutation, mutation } from './_generated/server.js';
import { hashKey, newKey, requireBar } from './keys.ts';
import { knocksFrom, knocksTo } from './knocks.ts';
import {
  OFFLINE_AFTER_MS,
  presenceValidator,
  samePresence,
} from './presence.ts';
import { MAX_BARS } from './team.ts';

/** Bar names: what the bitmap fonts draw, short enough for one row. */
const NAME = /^[\x20-\x7e]{1,12}$/u;

/**
 * Add a bar and answer the key its process signs in with. This is the only
 * time the key is shown; the README has the command.
 */
export const add = internalMutation({
  args: { name: v.string() },
  returns: v.object({ name: v.string(), key: v.string() }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!NAME.test(name)) {
      throw new ConvexError(
        'A bar name is 1 to 12 printable ASCII characters.',
      );
    }
    if ((await findByName(ctx, name)) !== null) {
      throw new ConvexError(`There already is a bar named ${name}.`);
    }
    if ((await ctx.db.query('bars').take(MAX_BARS)).length >= MAX_BARS) {
      throw new ConvexError(`A team holds at most ${MAX_BARS} bars.`);
    }
    const key = newKey();
    await ctx.db.insert('bars', {
      name,
      keyHash: await hashKey(key),
      online: false,
      presence: { state: 'free' },
    });
    return { name, key };
  },
});

/** Remove a bar, which also retires its key and drops its knocks. */
export const remove = internalMutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const name = args.name.trim();
    const bar = await findByName(ctx, name);
    if (bar === null) {
      throw new ConvexError(`There is no bar named ${name}.`);
    }
    await forgetHeartbeat(ctx, bar._id);
    for (const knock of [
      ...(await knocksFrom(ctx, bar._id)),
      ...(await knocksTo(ctx, bar._id)),
    ]) {
      await ctx.db.delete(knock._id);
    }
    await ctx.db.delete(bar._id);
    return null;
  },
});

/**
 * A bar's process reports what its BUSY timer says, when that changes and
 * at least every `HEARTBEAT_MS`. The bar's row changes only when its
 * presence does or it comes back online, so a heartbeat re-runs no board.
 */
export const report = mutation({
  args: { key: v.string(), presence: presenceValidator },
  returns: v.null(),
  handler: async (ctx, { key, presence }): Promise<null> => {
    const bar = await requireBar(ctx, key);
    if (!bar.online || !samePresence(bar.presence, presence)) {
      await ctx.db.patch(bar._id, { online: true, presence });
    }
    const expiry = await ctx.scheduler.runAfter(
      OFFLINE_AFTER_MS,
      internal.bars.expire,
      { bar: bar._id },
    );
    const heartbeat = await findHeartbeat(ctx, bar._id);
    if (heartbeat === null) {
      await ctx.db.insert('heartbeats', {
        bar: bar._id,
        seenAt: Date.now(),
        expiry,
      });
    } else {
      await ctx.scheduler.cancel(heartbeat.expiry);
      await ctx.db.patch(heartbeat._id, { seenAt: Date.now(), expiry });
    }
    return null;
  },
});

/** A bar's process stops: show the bar offline at once. */
export const leave = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }): Promise<null> => {
    const bar = await requireBar(ctx, key);
    await forgetHeartbeat(ctx, bar._id);
    if (bar.online) {
      await ctx.db.patch(bar._id, { online: false });
    }
    return null;
  },
});

/** Take a bar offline once it has stopped reporting. */
export const expire = internalMutation({
  args: { bar: v.id('bars') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const heartbeat = await findHeartbeat(ctx, args.bar);
    // A report that raced this call has already scheduled the next one.
    if (
      heartbeat === null ||
      Date.now() - heartbeat.seenAt < OFFLINE_AFTER_MS
    ) {
      return null;
    }
    await ctx.db.delete(heartbeat._id);
    const bar = await ctx.db.get(args.bar);
    if (bar?.online === true) {
      await ctx.db.patch(bar._id, { online: false });
    }
    return null;
  },
});

async function findByName(ctx: Pick<MutationCtx, 'db'>, name: string) {
  return await ctx.db
    .query('bars')
    .withIndex('by_name', (q) => q.eq('name', name))
    .unique();
}

async function findHeartbeat(ctx: Pick<MutationCtx, 'db'>, bar: Id<'bars'>) {
  return await ctx.db
    .query('heartbeats')
    .withIndex('by_bar', (q) => q.eq('bar', bar))
    .unique();
}

/** Drop a bar's heartbeat and the scheduled call that would expire it. */
async function forgetHeartbeat(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  bar: Id<'bars'>,
): Promise<void> {
  const heartbeat = await findHeartbeat(ctx, bar);
  if (heartbeat !== null) {
    await ctx.scheduler.cancel(heartbeat.expiry);
    await ctx.db.delete(heartbeat._id);
  }
}
