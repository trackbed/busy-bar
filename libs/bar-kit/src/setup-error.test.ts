import { describe, expect, it } from 'vitest';

import { SetupError } from './setup-error.ts';

describe('SetupError', () => {
  it('carries the hint for each display and keeps its cause', () => {
    const cause = new Error('Linear answered 401 Unauthorized');

    const error = new SetupError(
      'key rejected',
      ['Linear rejected the key.', 'Check LINEAR_API_KEY.'],
      { cause },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SetupError');
    expect(error.summary).toBe('key rejected');
    expect(error.lines).toStrictEqual([
      'Linear rejected the key.',
      'Check LINEAR_API_KEY.',
    ]);
    expect(error.message).toBe(
      'Linear rejected the key. Check LINEAR_API_KEY.',
    );
    expect(error.cause).toBe(cause);
  });
});
