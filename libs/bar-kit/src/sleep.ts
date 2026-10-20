// Abort-aware waiting shared by the frame loop and the poller.

/**
 * Read `aborted` through a call so TypeScript does not narrow it to the value
 * a loop condition saw before an `await`.
 */
export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Wait `ms` milliseconds, or less if `signal` aborts first. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });

    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}
