import type { Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import type { Board, Focus, Knock, TeamBar } from './board.ts';
import { FOCUS_ROW } from './board.ts';
import { FOCUS_LEAD_MS } from './convex/focus.ts';
import type { Presence } from './convex/presence.ts';
import type { TeamView } from './render.ts';
import { render } from './render.ts';
import { DEFAULT_FOCUS_MINUTES } from './settings.ts';

const NOW = new Date('2026-10-26T13:00:00Z');
const MINUTE = 60_000;

function bar(name: string, presence: Presence, online = true): TeamBar {
  return { id: name.toLowerCase(), name, online, presence };
}

function inMinutes(minutes: number): number {
  return NOW.getTime() + minutes * MINUTE;
}

/** The team as Eva's bar sees it. */
function board(
  teammates: readonly TeamBar[],
  knocks: readonly Knock[] = [],
  focus: Focus | null = null,
): Board {
  const me = bar('Eva', { state: 'free' });
  return {
    me: me.id,
    bars: [...teammates, me].sort((a, b) => a.name.localeCompare(b.name)),
    knocks,
    focus,
  };
}

function view(fields: Partial<TeamView> & Pick<TeamView, 'board'>): TeamView {
  return {
    failure: undefined,
    connected: true,
    selected: undefined,
    focusMinutes: DEFAULT_FOCUS_MINUTES,
    ...fields,
  };
}
const TEAM = [
  bar('Anna', { state: 'busy', endsAt: inMinutes(18) }),
  bar('Ben', { state: 'free' }),
  bar('Cleo', { state: 'resting', endsAt: inMinutes(4) }),
  bar('Dan', { state: 'free' }, false),
  bar('Finn', { state: 'paused', leftMs: 12 * MINUTE }),
];

/** Sample frames for the app catalogue: `nx run intercom:preview`. */
export function preview(): Preview {
  return {
    summary:
      "Who on the team is free, from every bar's BUSY timer, knocks between bars, and focus sessions the whole team starts at once, shared through a Convex deployment.",
    steps: [
      {
        label: 'Reads',
        text: "This bar's BUSY timer every 5 seconds, its wheel and buttons, and the team's board from the Convex deployment at INTERCOM_CONVEX_URL over a live subscription.",
      },
      {
        label: 'Decides',
        text: 'Each bar reports free, busy, resting, or paused when that changes and every minute otherwise; one silent for 2.5 minutes shows offline. A knock reaches only a free bar and waits 2 minutes for an answer. A team focus starts 15 seconds after someone starts it, on every free bar that does not skip it.',
      },
      {
        label: 'Draws',
        text: 'How many teammates are free and who, one cell per teammate along the bottom, and every teammate with the minutes their timer has left behind. A knock takes over both displays until it is answered.',
      },
    ],
    scenes: [
      {
        title: 'Someone is free',
        caption:
          'Ben is free, so the count is green and OK would knock on him. Anna has 18 minutes of focus left, Cleo is on a break, Finn paused his timer, and Dan is offline.',
        elements: render(NOW, view({ board: board(TEAM), selected: 'ben' })),
      },
      {
        title: 'Everyone heads down',
        caption:
          'Nobody is free, so the count turns red and names whose timer ends first. A timer without an end shows BUSY with no minutes.',
        elements: render(
          NOW,
          view({
            board: board([
              bar('Anna', { state: 'busy', endsAt: inMinutes(18) }),
              bar('Ben', { state: 'busy', endsAt: null }),
              bar('Cleo', { state: 'busy', endsAt: inMinutes(65) }),
            ]),
          }),
        ),
      },
      {
        title: 'A knock',
        caption:
          'Ben knocked on Eva. Her bar chimes and asks for an answer: OK says she is coming, BACK says later.',
        elements: render(
          NOW,
          view({
            board: board(TEAM, [
              { id: 'k1', from: 'ben', to: 'eva', status: 'waiting' },
            ]),
          }),
        ),
      },
      {
        title: 'The answer',
        caption:
          'Eva knocked on Ben, and he is on his way: the answer shows in the header for a minute, with a chime.',
        elements: render(
          NOW,
          view({
            board: board(TEAM, [
              { id: 'k2', from: 'eva', to: 'ben', status: 'coming' },
            ]),
            selected: 'ben',
          }),
        ),
      },
      {
        title: 'Focus together',
        caption:
          'The wheel went past the teammates to the last row: OK starts a 25-minute team focus, and every free bar joins it.',
        elements: render(
          NOW,
          view({ board: board(TEAM), selected: FOCUS_ROW }),
        ),
      },
      {
        title: 'A team focus starts',
        caption:
          'Ben started a team focus. Every free bar counts down 15 seconds, with a chime, and BACK skips it; then each bar runs its BUSY timer from the same moment, so they all end together.',
        elements: render(
          new Date(NOW.getTime() + FOCUS_LEAD_MS - 9000),
          view({
            board: board(TEAM, [], {
              id: 'f1',
              startedBy: 'ben',
              startsAt: NOW.getTime() + FOCUS_LEAD_MS,
              endsAt: NOW.getTime() + FOCUS_LEAD_MS + 25 * MINUTE,
              cardId: '00000000-0000-4000-8000-000000000000',
              skipped: [],
            }),
          }),
        ),
      },
      {
        title: 'Lost the team',
        caption:
          'The connection to Convex dropped: the bar keeps the last board and says it is old until the client reconnects.',
        elements: render(
          NOW,
          view({
            board: board([
              bar('Anna', { state: 'free' }),
              bar('Ben', { state: 'busy', endsAt: inMinutes(7) }),
            ]),
            connected: false,
          }),
        ),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
