// Polling for the server tests: wait on real time for what a socket or
// stream delivers in the background.

import { setTimeout as sleep } from 'node:timers/promises';

/** Wait, on real time, until `check` holds. */
export async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await sleep(2);
  }
}
