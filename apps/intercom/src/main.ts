import { ConvexClient } from 'convex/browser';

import {
  createBusyBar,
  createPoller,
  createSpeaker,
  listenForInput,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
  trackScreen,
} from '@busy-bar-apps/bar-kit';

import { createBoardFeed } from './board.ts';
import { createChime } from './chime.ts';
import { createControls } from './controls.ts';
import { api } from './convex/_generated/api.js';
import { createFocusDriver } from './focus.ts';
import { render } from './render.ts';
import { createReporter, leaveTeam } from './reporter.ts';
import { loadSettings } from './settings.ts';
import { presenceAt } from './timer.ts';

const NAME = 'intercom';
// Reading the bar is local and cheap; reports go out only on change.
const TIMER_POLL_MS = 5000;
const LEAVE_TIMEOUT_MS = 2000;

const settings = loadSettings(process.env);
const { key } = settings;
const signal = shutdownSignal();
const config = loadBarConfig();
const bar = createBusyBar(config);
const screen = trackScreen(bar);
const convex = new ConvexClient(settings.convexUrl);

const focus = createFocusDriver({
  name: NAME,
  snapshot: () => bar.BusySnapshotGet(),
  start: (snapshot) => bar.BusySnapshotSet(snapshot),
});
const speaker = createSpeaker({
  name: NAME,
  client: bar,
  enabled: settings.sound,
  signal,
});
const chime = createChime({ play: speaker.play });
const feed = createBoardFeed([focus.observe, chime.observe]);
const unsubscribe = convex.onUpdate(
  api.team.board,
  { key },
  feed.update,
  feed.fail,
);

const controls = createControls({
  name: NAME,
  board: feed.board,
  onScreen: screen.onScreen,
  knock: (to) => convex.mutation(api.knocks.send, { key, to }),
  answer: (knock, reply) =>
    convex.mutation(api.knocks.answer, { key, knock, reply }),
  startFocus: () =>
    convex.mutation(api.focus.start, { key, minutes: settings.focusMinutes }),
  skipFocus: (session) =>
    convex.mutation(api.focus.skip, { key, focus: session }),
  joinFocus: focus.join,
});
const reporter = createReporter({
  name: NAME,
  send: (presence) => convex.mutation(api.bars.report, { key, presence }),
});
const timer = createPoller({
  name: NAME,
  intervalMs: TIMER_POLL_MS,
  fetch: async (fetchSignal) => {
    const snapshot = await bar.BusySnapshotGet({ signal: fetchSignal });
    const presence = presenceAt(snapshot, Date.now());
    void reporter.observe(presence, Date.now());
    return presence;
  },
});

try {
  await Promise.all([
    timer.run(signal),
    listenForInput({ name: NAME, config, handle: controls.handle, signal }),
    runBarApp({
      name: NAME,
      client: screen.client,
      render: (now) =>
        render(now, {
          board: feed.board(),
          failure: feed.failure(),
          connected: convex.connectionState().isWebSocketConnected,
          selected: controls.selected(),
          focusMinutes: settings.focusMinutes,
        }),
      intervalMs: 1000,
      signal,
    }),
  ]);
} finally {
  unsubscribe();
  focus.stop();
  await leaveTeam({
    name: NAME,
    leave: () => convex.mutation(api.bars.leave, { key }),
    timeoutMs: LEAVE_TIMEOUT_MS,
  });
  await convex.close();
}
