import type { Presence } from './convex/presence.ts';
import { HEARTBEAT_MS, samePresence } from './convex/presence.ts';

export interface ReporterOptions {
  /** Names the app in log messages. */
  readonly name: string;
  /** Send one report to the team, such as the `bars:report` mutation. */
  readonly send: (presence: Presence) => Promise<unknown>;
  readonly log?: Pick<Console, 'warn'>;
}

/** Tells the team what this bar's BUSY timer says. */
export interface Reporter {
  /**
   * Report `presence` if it differs from the last report that went through,
   * or if a heartbeat is due. Only one report is in flight at a time, so a
   * lost connection queues one report, not one per call. A failed report is
   * tried again on the next call. Resolves once the report, if any, settles.
   */
  observe(presence: Presence, now: number): Promise<void>;
}

export function createReporter(options: ReporterOptions): Reporter {
  const { name, send, log = console } = options;
  let sent: { readonly presence: Presence; readonly at: number } | undefined;
  let sending = false;
  let failing = false;

  return {
    async observe(presence, now) {
      const due =
        sent === undefined ||
        !samePresence(sent.presence, presence) ||
        now - sent.at >= HEARTBEAT_MS;
      if (!due || sending) {
        return;
      }
      sending = true;
      try {
        await send(presence);
        sent = { presence, at: now };
        failing = false;
      } catch (error) {
        // Log the first failure of a run, not one every poll.
        if (!failing) {
          log.warn(`[${name}] Reporting to the team failed:`, error);
        }
        failing = true;
      } finally {
        sending = false;
      }
    },
  };
}
