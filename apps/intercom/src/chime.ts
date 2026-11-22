import type { StockSound } from '@busy-bar-apps/bar-kit';

import type { Board } from './board.ts';
import { incomingKnock, outgoingKnock, startingFocus } from './board.ts';

/** The stock sound each event plays. */
const SOUNDS: Readonly<Record<'focus' | 'knock' | 'answer', StockSound>> = {
  focus: 'event',
  knock: 'event',
  answer: 'reminder',
};

export interface ChimeOptions {
  /** Starts a sound and returns at once, such as bar-kit's `Speaker.play`. */
  readonly play: (sound: StockSound) => void;
  readonly now?: () => number;
}

/**
 * Sounds a team focus about to start, a knock on this bar, and an answer to
 * the knock it sent.
 */
export interface Chime {
  /**
   * Look at a new board and play one sound for what it shows first and was
   * not heard before: a team focus, a knock, then an answer. A lost board
   * (`undefined`) plays nothing.
   */
  readonly observe: (board: Board | undefined) => void;
}

export function createChime(options: ChimeOptions): Chime {
  const { play, now = Date.now } = options;
  const heard = new Set<string>();

  return {
    observe: (board) => {
      if (board === undefined) {
        return;
      }
      const incoming = incomingKnock(board);
      const outgoing = outgoingKnock(board);
      const answered =
        outgoing === undefined || outgoing.status === 'waiting'
          ? undefined
          : `${outgoing.id}:${outgoing.status}`;
      const starting = startingFocus(board, now());
      const focus = starting === undefined ? undefined : `focus:${starting.id}`;
      let sound: StockSound | undefined;
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
      if (sound !== undefined) {
        play(sound);
      }
    },
  };
}
