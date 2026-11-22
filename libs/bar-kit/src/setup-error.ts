/**
 * A failure only the person running the app can fix, such as a rejected key
 * or a missing file. The client that learns the cause throws it, and the
 * app's screen for a source it cannot read shows `summary` (a few words for
 * the front display) and `lines` (what to change, one per back row) instead of
 * the message. Pass the original error as `cause` so the log keeps it. The
 * Python kit's `SetupError` carries the same.
 */
export class SetupError extends Error {
  override readonly name = 'SetupError';
  readonly summary: string;
  readonly lines: readonly string[];

  constructor(
    summary: string,
    lines: readonly string[],
    options?: ErrorOptions,
  ) {
    super(lines.join(' '), options);
    this.summary = summary;
    this.lines = lines;
  }
}
