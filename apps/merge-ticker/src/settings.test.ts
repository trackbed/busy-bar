import { describe, expect, it } from 'vitest';

import { SettingsError } from '@busy-bar-apps/bar-kit';

import { loadSettings } from './settings.ts';

describe('loadSettings', () => {
  it('needs only a token', () => {
    expect(loadSettings({ GITHUB_TOKEN: ' gho_secret ' })).toStrictEqual({
      token: 'gho_secret',
      scope: '',
      timeZone: undefined,
      sound: true,
    });
  });

  it('reads the optional settings', () => {
    expect(
      loadSettings({
        GITHUB_TOKEN: 'gho_secret',
        MERGE_TICKER_SCOPE: ' org:consensusaps ',
        MERGE_TICKER_TIME_ZONE: 'Europe/Copenhagen',
        MERGE_TICKER_SOUND: 'OFF',
      }),
    ).toStrictEqual({
      token: 'gho_secret',
      scope: 'org:consensusaps',
      timeZone: 'Europe/Copenhagen',
      sound: false,
    });
  });

  it.each([
    [{}, 'Set GITHUB_TOKEN'],
    [{ GITHUB_TOKEN: '  ' }, 'Set GITHUB_TOKEN'],
    [
      { GITHUB_TOKEN: 't', MERGE_TICKER_TIME_ZONE: 'Mars/Base' },
      'IANA time zone',
    ],
    [{ GITHUB_TOKEN: 't', MERGE_TICKER_SOUND: 'loud' }, 'on or off'],
    [{ GITHUB_TOKEN: 't', MERGE_TICKER_SOUND: 'constructor' }, 'on or off'],
    [{ GITHUB_TOKEN: 't', MERGE_TICKER_SOUND: '__proto__' }, 'on or off'],
  ])('rejects %j', (env, message) => {
    expect(() => loadSettings(env)).toThrow(SettingsError);
    expect(() => loadSettings(env)).toThrow(message);
  });
});
