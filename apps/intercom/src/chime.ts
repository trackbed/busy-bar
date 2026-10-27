import type { Board } from './board.ts';
import { incomingKnock, outgoingKnock, startingFocus } from './board.ts';

/** Sounds every bar ships (busylib's `features.notification`). */
export const SOUNDS = {
  focus: 'shared/sounds/calendar_event_starts.snd',
  knock: 'shared/sounds/calendar_event_starts.snd',
  answer: 'shared/sounds/calendar_reminder_ends.snd',
} as const;

export interface ChimeOptions {
  /** Names the app in log messages. */
  readonly name: string;
  readonly enabled: boolean;
  /** Play a stock sound, such as busy-lib's `AudioPlay`. */
  readonly play: (sound: string) => Promise<unknown>;
  readonly now?: () => number;
  readonly log?: Pick<Console, 'warn'>;
}

/**
 * Sounds a team focus about to start, a knock on this bar, and an answer to
 * the knock it sent.
 */
export interface Chime {
  /**
   * Look at a new board and play one sound for what it shows first and was
   * not heard before: a team focus, a knock, then an answer.
   */
  readonly observe: (board: Board) => void;
}

export function createChime(options: ChimeOptions): Chime {
  const { name, enabled, play, now = Date.now, log = console } = options;
  const heard = new Set<string>();

  return {
    observe: (board) => {
      const incoming = incomingKnock(board);
      const outgoing = outgoingKnock(board);
      const answered =
        outgoing === undefined || outgoing.status === 'waiting'
          ? undefined
          : `${outgoing.id}:${outgoing.status}`;
      const starting = startingFocus(board, now());
      const focus = starting === undefined ? undefined : `focus:${starting.id}`;
      let sound: string | undefined;
      if (focus !== undefined && !heard.has(focus)) {
        heard.add(focus);
        sound = SOUNDS.focus;
      } else if (incoming !== undefined && !heard.has(incoming.id)) {
        heard.add(incoming.id);
        sound = SOUNDS.knock;
      } else if (answered !== undefined && !heard.has(answered)) {
        heard.add(answered);
        sound = SOUNDS.answer;
      }
      // Forget knocks the board no longer shows; their ids never come back.
      const shown = new Set(
        board.knocks.flatMap((knock) => [
          knock.id,
          `${knock.id}:${knock.status}`,
        ]),
      );
      if (focus !== undefined) {
        shown.add(focus);
      }
      for (const id of heard) {
        if (!shown.has(id)) {
          heard.delete(id);
        }
      }
      if (enabled && sound !== undefined) {
        play(sound).catch((error: unknown) => {
          log.warn(`[${name}] Playing ${sound} failed:`, error);
        });
      }
    },
  };
}
