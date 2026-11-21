import { describe, expect, it } from 'vitest';

import { SettingsError } from '@busy-bar-apps/bar-kit';

import { DEFAULT_LOW, loadSettings } from './settings.ts';

describe('loadSettings', () => {
  it('needs only an API key and counts the DISC team by default', () => {
    expect(loadSettings({ LINEAR_API_KEY: ' lin_api_key ' })).toStrictEqual({
      apiKey: 'lin_api_key',
      scope: { team: 'DISC', label: undefined, mine: false },
      low: DEFAULT_LOW,
    });
  });

  it('reads the optional settings', () => {
    expect(
      loadSettings({
        LINEAR_API_KEY: 'k',
        LINEAR_QUEUE_TEAM: ' eng ',
        LINEAR_QUEUE_LABEL: ' agent-ready ',
        LINEAR_QUEUE_ASSIGNEE: 'ME',
        LINEAR_QUEUE_LOW: '0',
      }),
    ).toStrictEqual({
      apiKey: 'k',
      scope: { team: 'ENG', label: 'agent-ready', mine: true },
      low: 0,
    });
  });

  it.each([
    [{}, 'Set LINEAR_API_KEY'],
    [
      { LINEAR_API_KEY: 'k', LINEAR_QUEUE_ASSIGNEE: 'anna' },
      'can only be "me"',
    ],
    [{ LINEAR_API_KEY: 'k', LINEAR_QUEUE_LOW: 'few' }, 'whole number'],
    [{ LINEAR_API_KEY: 'k', LINEAR_QUEUE_LOW: '-1' }, 'whole number'],
    [{ LINEAR_API_KEY: 'k', LINEAR_QUEUE_LOW: '2.0' }, 'whole number'],
  ])('rejects %j', (env, message) => {
    expect(() => loadSettings(env)).toThrow(SettingsError);
    expect(() => loadSettings(env)).toThrow(message);
  });
});
