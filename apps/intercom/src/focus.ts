// Joining a team focus on this bar: when a session starts, run the bar's
// BUSY timer from a snapshot stamped with that moment. The firmware counts
// time left from the stamp, so every bar that joins ends with the others.

import type { BusySnapshot } from '@busy-bar-apps/bar-kit';

import type { Board, Focus } from './board.ts';
import { presenceAt } from './timer.ts';

/** How long after a session starts a bar still joins it by itself. */
export const JOIN_WINDOW_MS = 30_000;

export interface FocusOptions {
  /** Names the app in log messages. */
  readonly name: string;
  /** Read the bar's BUSY timer now: busy-lib's `BusySnapshotGet`. */
  readonly snapshot: () => Promise<BusySnapshot>;
  /** Run the bar's BUSY timer from a snapshot: busy-lib's `BusySnapshotSet`. */
  readonly start: (snapshot: BusySnapshot) => Promise<unknown>;
  readonly now?: () => number;
  readonly log?: Pick<Console, 'warn'>;
}

/** Puts this bar into the team focus. */
export interface FocusDriver {
  /**
   * Look at a new board: plan to join a session this bar has not skipped
   * when it starts, or drop the plan for one it skipped or that was called
   * off. A session that started more than {@link JOIN_WINDOW_MS} ago is
   * left alone. A lost board (`undefined`) drops a plan that has not run
   * yet, since this bar no longer knows the session is on; it plans again
   * if the board comes back with it. A session this bar already tried to
   * join is not joined again.
   */
  readonly observe: (board: Board | undefined) => void;
  /** Join a session now; the bar's timer ends with the team's. */
  readonly join: (focus: Focus) => Promise<void>;
  /** Drop the plan, as the app stops. */
  readonly stop: () => void;
}

export function createFocusDriver(options: FocusOptions): FocusDriver {
  const { name, snapshot, start, now = Date.now, log = console } = options;
  let planned: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    clearTimeout(planned);
    planned = undefined;
  };

  const join = async (focus: Focus): Promise<void> => {
    try {
      const current = await snapshot();
      // A bar whose owner runs a timer of their own keeps it.
      if (presenceAt(current, now()).state !== 'free') {
        return;
      }
      // The bar ignores a snapshot no newer than its own, such as one its
      // owner recorded by stopping a timer after the session started.
      const at = Math.max(focus.startsAt, current.snapshot_timestamp_ms + 1);
      await start({
        snapshot: {
          type: 'SIMPLE',
          card_id: focus.cardId,
          is_paused: false,
          time_left_ms: focus.endsAt - at,
          busy_bar_settings: current.snapshot.busy_bar_settings,
        },
        snapshot_timestamp_ms: at,
      });
    } catch (error) {
      log.warn(`[${name}] Joining the team focus failed:`, error);
    }
  };

  // The sessions already joined or planned: one try each.
  let tried = new Set<string>();

  return {
    observe: (board) => {
      if (board === undefined) {
        // Only a session whose join has not run yet gets another try.
        if (planned !== undefined) {
          stop();
          tried = new Set();
        }
        return;
      }
      const { focus } = board;
      if (focus === null || focus.skipped.includes(board.me)) {
        stop();
        tried = new Set();
        return;
      }
      if (tried.has(focus.id)) {
        return;
      }
      stop();
      tried = new Set([focus.id]);
      const wait = focus.startsAt - now();
      if (wait < -JOIN_WINDOW_MS) {
        return;
      }
      planned = setTimeout(
        () => {
          planned = undefined;
          void join(focus);
        },
        Math.max(0, wait),
      );
    },
    join,
    stop,
  };
}
