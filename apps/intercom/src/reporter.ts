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

export interface LeaveOptions {
  /** Names the app in log messages. */
  readonly name: string;
  /** Tell the team this bar left, such as the `bars:leave` mutation. */
  readonly leave: () => Promise<unknown>;
  /** How long to wait for `leave` before giving up. */
  readonly timeoutMs: number;
  readonly log?: Pick<Console, 'warn'>;
}

/**
 * Tell the team this bar left as the app stops, so it shows offline at once
 * rather than when its heartbeat expires. Gives up after `timeoutMs`, so an
 * unreachable deployment does not hold up the exit, and logs a failure.
 */
export async function leaveTeam(options: LeaveOptions): Promise<void> {
  const { name, leave, timeoutMs, log = console } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    leave().then(
      () => undefined,
      (error: unknown) => {
        log.warn(`[${name}] Leaving the team failed:`, error);
      },
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
}
