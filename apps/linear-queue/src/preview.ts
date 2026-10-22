import type { BarElements, Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import type { QueueCounts, QueueScope } from './linear.ts';
import { render } from './render.ts';
import { DEFAULT_LOW } from './settings.ts';

// The last count came two minutes before the frame.
const NOW = new Date('2026-10-21T08:30:00Z');
const COUNTED_AT = new Date('2026-10-21T08:28:00Z');

const TODO: QueueScope = { team: 'DISC', label: undefined, mine: false };
const AGENT_READY: QueueScope = {
  team: 'DISC',
  label: 'agent-ready',
  mine: false,
};

function frame(scope: QueueScope, counts: QueueCounts): BarElements {
  return render(NOW, { value: counts, at: COUNTED_AT }, undefined, {
    scope,
    low: DEFAULT_LOW,
  });
}

/** Sample frames for the app catalogue: `nx run linear-queue:preview`. */
export function preview(): Preview {
  return {
    summary:
      "How many issues in a Linear team's queue are ready to start, so you know when to refine the backlog again.",
    steps: [
      {
        label: 'Reads',
        text: "The open issues of LINEAR_QUEUE_TEAM (DISC by default) and the past week's completions, from Linear's GraphQL API every 3 minutes with LINEAR_API_KEY.",
      },
      {
        label: 'Decides',
        text: 'Ready is every Todo issue, or with LINEAR_QUEUE_LABEL set every labelled issue in Backlog or Todo, and started issues whose state name mentions review count as in review.',
      },
      {
        label: 'Draws',
        text: 'The ready count in green, amber below LINEAR_QUEUE_LOW (3 by default), or red at zero, over a strip that splits ready, in progress, and in review.',
      },
    ],
    scenes: [
      {
        title: 'Healthy queue',
        caption:
          'Nine issues wait in Todo, well above the low mark, so the count is green and blue ready work fills more than half the strip.',
        elements: frame(TODO, {
          ready: 9,
          inProgress: 4,
          inReview: 3,
          backlog: 142,
          doneThisWeek: 17,
          capped: false,
        }),
      },
      {
        title: 'Running low',
        caption:
          'Only two issues are ready while eight are in flight: the count turns amber, a cue for another backlog-refine pass.',
        elements: frame(TODO, {
          ready: 2,
          inProgress: 5,
          inReview: 3,
          backlog: 151,
          doneThisWeek: 21,
          capped: false,
        }),
      },
      {
        title: 'Nothing labelled',
        caption:
          'Counting only issues labelled agent-ready, none are left, so the count is red and the strip holds only work in flight.',
        elements: frame(AGENT_READY, {
          ready: 0,
          inProgress: 3,
          inReview: 2,
          backlog: 156,
          doneThisWeek: 24,
          capped: false,
        }),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
