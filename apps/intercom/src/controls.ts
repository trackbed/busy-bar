import type { InputEvent } from '@busy-bar-apps/bar-kit';

import type { Board, Focus, Knock } from './board.ts';
import {
  runningFocus,
  screenOf,
  selectable,
  selectionOf,
  statusAt,
} from './board.ts';

type Reply = 'coming' | 'later';

export interface ControlsOptions {
  /** Names the app in log messages. */
  readonly name: string;
  /** The board on screen now. */
  readonly board: () => Board | undefined;
  /** Whether the app's last frame reached the screen. */
  readonly onScreen: () => boolean;
  /** Knock on the bar with this id, such as the `knocks:send` mutation. */
  readonly knock: (to: string) => Promise<unknown>;
  /** Answer the knock with this id, such as `knocks:answer`. */
  readonly answer: (knock: string, reply: Reply) => Promise<unknown>;
  /** Start a team focus, such as `focus:start`. */
  readonly startFocus: () => Promise<unknown>;
  /** Skip the team focus with this id, or call it off: `focus:skip`. */
  readonly skipFocus: (focus: string) => Promise<unknown>;
  /** Join a running team focus on this bar. */
  readonly joinFocus: (focus: Focus) => Promise<unknown>;
  readonly now?: () => number;
  readonly log?: Pick<Console, 'warn'>;
}

/** What the wheel and buttons do on the team's board. */
export interface Controls {
  /** What the wheel last pointed at; see `selectionOf`. */
  readonly selected: () => string | undefined;
  readonly handle: (event: InputEvent) => void;
}

/**
 * The wheel moves the highlight over the teammates and the team-focus row.
 * OK knocks on a highlighted teammate who is free, or on the focus row
 * starts a team focus, or joins the one running. While a team focus counts
 * down, BACK skips it (or calls it off, on the bar that started it); while a
 * knock waits on this bar, OK answers "coming" and BACK "later". The bar
 * reports input to every listener, so presses meant for the BUSY timer or
 * another app do nothing: only those while the app's last frame reached the
 * screen count.
 */
export function createControls(options: ControlsOptions): Controls {
  const {
    name,
    board,
    onScreen,
    knock,
    answer,
    startFocus,
    skipFocus,
    joinFocus,
    now = Date.now,
    log = console,
  } = options;
  let selected: string | undefined;

  const send = (what: string, request: Promise<unknown>): void => {
    request.catch((error: unknown) => {
      log.warn(`[${name}] ${what} failed:`, error);
    });
  };

  const press = (event: InputEvent, button: 'ok' | 'back'): boolean =>
    event.kind === 'button' &&
    event.button === button &&
    event.action === 'press';

  /** While a team focus counts down: BACK skips it, or calls it off. */
  const onCountdown = (event: InputEvent, focus: Focus): void => {
    if (press(event, 'back')) {
      send('Skipping the team focus', skipFocus(focus.id));
    }
  };

  /** While a knock waits on this bar: OK answers "coming", BACK "later". */
  const onKnock = (event: InputEvent, waiting: Knock): void => {
    let reply: Reply | undefined;
    if (press(event, 'ok')) {
      reply = 'coming';
    } else if (press(event, 'back')) {
      reply = 'later';
    }
    if (reply !== undefined) {
      send('Answering the knock', answer(waiting.id, reply));
    }
  };

  /** On the team's board: the wheel moves the highlight, OK acts on it. */
  const onTeam = (event: InputEvent, shown: Board, at: number): void => {
    const selection = selectionOf(shown, selected);
    if (event.kind === 'wheel') {
      // A positive step moves the highlight down, as in agent-fleet.
      const order = selectable(shown);
      const current =
        selection?.kind === 'teammate' ? selection.bar.id : selected;
      const index = Math.max(0, order.indexOf(current ?? ''));
      selected =
        order[Math.max(0, Math.min(order.length - 1, index + event.delta))];
      return;
    }
    if (!press(event, 'ok') || selection === undefined) {
      return;
    }
    if (selection.kind === 'teammate') {
      if (statusAt(selection.bar, at).status === 'free') {
        send(`Knocking on ${selection.bar.name}`, knock(selection.bar.id));
      }
      return;
    }
    const running = runningFocus(shown, at);
    if (running !== undefined) {
      send('Joining the team focus', joinFocus(running));
    } else if (shown.focus === null) {
      send('Starting a team focus', startFocus());
    }
  };

  return {
    selected: () => selected,
    handle: (event) => {
      const shown = board();
      if (shown === undefined || !onScreen()) {
        return;
      }
      const at = now();
      const screen = screenOf(shown, at);
      switch (screen.kind) {
        case 'countdown':
          onCountdown(event, screen.focus);
          return;
        case 'knock':
          onKnock(event, screen.knock);
          return;
        case 'team':
          onTeam(event, shown, at);
          return;
      }
    },
  };
}
