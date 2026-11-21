import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { knockStatusValidator, presenceValidator } from './presence.ts';

export default defineSchema({
  // One row per bar on the team. Every bar subscribes to this table, so a
  // write here reaches them all: change it only when what they show changes.
  bars: defineTable({
    name: v.string(),
    /** SHA-256 of the key the bar's process signs in with, as hex. */
    keyHash: v.string(),
    online: v.boolean(),
    presence: presenceValidator,
  })
    .index('by_name', ['name'])
    .index('by_key', ['keyHash']),
  // When each bar last reported, and the scheduled call that takes it
  // offline. Every report rewrites its row; no subscription reads this table.
  heartbeats: defineTable({
    bar: v.id('bars'),
    seenAt: v.number(),
    expiry: v.id('_scheduled_functions'),
  }).index('by_bar', ['bar']),
  // One bar asking another for a minute. Each board reads only the knocks to
  // and from its own bar, so a knock re-runs the two boards it concerns.
  knocks: defineTable({
    from: v.id('bars'),
    to: v.id('bars'),
    status: knockStatusValidator,
  })
    .index('by_from', ['from'])
    .index('by_to', ['to']),
  // The team focus, while one is starting or running: at most one row. Every
  // board reads it, so it changes only when a session starts, a bar skips
  // it, or it ends.
  focusSessions: defineTable({
    startedBy: v.id('bars'),
    /** When every joining bar's BUSY timer starts. */
    startsAt: v.number(),
    endsAt: v.number(),
    /** The BUSY timer card every joining bar runs, a UUID. */
    cardId: v.string(),
    skipped: v.array(v.id('bars')),
  }),
});
