import type { BarElements, Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import type { MergedPullRequest, OpenPullRequest } from './github.ts';
import { render } from './render.ts';
import type { TickerState } from './watch.ts';

// 10:30 in Copenhagen; the last reading came 20 seconds earlier.
const NOW = new Date('2026-10-21T08:30:00Z');
const READ_AT = new Date('2026-10-21T08:29:40Z');

function pull(
  repo: string,
  number: number,
  title: string,
  overrides: Partial<OpenPullRequest> = {},
): OpenPullRequest {
  return {
    repo,
    number,
    title,
    draft: false,
    autoMerge: false,
    checks: 'passing',
    ...overrides,
  };
}

const SEARCH_INPUT = pull('acme/web', 482, 'Debounce search', {
  autoMerge: true,
});
const RETRY_UPLOADS = pull('acme/api', 1317, 'Retry uploads', {
  autoMerge: true,
  checks: 'pending',
});
const DARK_MODE = pull('acme/ui', 96, 'Dark mode tokens', {
  draft: true,
  checks: 'none',
});
const BILLING_DATES = pull('acme/billing', 214, 'Fix due dates');

const RATE_LIMITS: MergedPullRequest = {
  repo: 'acme/api',
  number: 1309,
  title: 'Add rate limit headers',
  mergedAt: new Date('2026-10-21T08:29:52Z'),
};

function state(
  open: OpenPullRequest[],
  mergedToday: number,
  celebration?: TickerState['celebration'],
): TickerState {
  return {
    pulls: {
      open,
      openCount: open.length,
      mergedToday,
      merged: celebration === undefined ? [] : [celebration.merge],
    },
    celebration,
  };
}

function frame(value: TickerState): BarElements {
  return render(NOW, { value, at: READ_AT }, undefined);
}

/** Sample frames for the app catalogue: `nx run merge-ticker:preview`. */
export function preview(): Preview {
  return {
    summary:
      "Your open GitHub pull requests and today's merges, led by whichever pull request needs you.",
    steps: [
      {
        label: 'Reads',
        text: 'Your open pull requests and those merged since midnight, in one GitHub GraphQL request a minute with GITHUB_TOKEN.',
      },
      {
        label: 'Decides',
        text: 'The front focuses on failing checks first, then pull requests queued for auto-merge, then everything open.',
      },
      {
        label: 'Draws',
        text: "Today's merge count beside the focus, one cell per open pull request coloured by its checks, and the list behind.",
      },
      {
        label: 'Alerts',
        text: 'A new merge takes over the front for 15 seconds with a sound, newly failing checks play a sound too, and MERGE_TICKER_SOUND=off silences both.',
      },
    ],
    scenes: [
      {
        title: 'Failing checks',
        caption:
          'A failing check on billing#214 outranks everything, so it takes the front; the cells below colour each open pull request by its checks.',
        elements: frame(
          state(
            [
              { ...BILLING_DATES, checks: 'failing' },
              SEARCH_INPUT,
              RETRY_UPLOADS,
              DARK_MODE,
            ],
            2,
          ),
        ),
      },
      {
        title: 'Auto-merge queue',
        caption:
          'With nothing failing, the front counts the pull requests GitHub will merge once their checks pass, tagged auto behind.',
        elements: frame(
          state([SEARCH_INPUT, RETRY_UPLOADS, BILLING_DATES, DARK_MODE], 2),
        ),
      },
      {
        title: 'Merge celebration',
        caption:
          'api#1309 merged a few seconds ago: the count goes up and MERGED! holds the front for 15 seconds.',
        elements: frame(
          state([SEARCH_INPUT, BILLING_DATES, DARK_MODE], 3, {
            merge: RATE_LIMITS,
            noticedAt: new Date('2026-10-21T08:29:56Z'),
          }),
        ),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
