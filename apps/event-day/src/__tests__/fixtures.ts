// Helpers for event-day's test files that fake `fetch`.

/** The JSON body a fake fetch received. */
export function bodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return JSON.parse(typeof body === 'string' ? body : 'null');
}
