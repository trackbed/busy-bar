import { describe, expect, it } from 'vitest';

import { DEFAULT_PRIORITY } from '@busy-bar-apps/bar-kit';

import {
  DEFAULT_QUIET_MINUTES,
  EventSettingsError,
  loadSettings,
} from './settings.ts';

describe('loadSettings', () => {
  it('reads booths with the PhotoCraft URL', () => {
    expect(
      loadSettings({
        EVENT_DAY_PHOTOCRAFT_URL: 'https://photos.example.com',
        EVENT_DAY_BOOTHS: ' summit-2026/main-booth , summit-2026/side-booth ',
      }),
    ).toStrictEqual({
      photoCraftUrl: 'https://photos.example.com',
      booths: [
        { eventSlug: 'summit-2026', boothSlug: 'main-booth' },
        { eventSlug: 'summit-2026', boothSlug: 'side-booth' },
      ],
      quietMinutes: DEFAULT_QUIET_MINUTES,
      challenge: undefined,
      priority: DEFAULT_PRIORITY,
      sound: true,
    });
  });

  it('reads a challenge on its own and the optional settings', () => {
    expect(
      loadSettings({
        EVENT_DAY_CHALLENGE_URL: 'https://happy-otter-123.convex.cloud',
        EVENT_DAY_CHALLENGE_TOKEN: ' tv-token ',
        EVENT_DAY_QUIET_MINUTES: '5',
        EVENT_DAY_PRIORITY: '91',
        EVENT_DAY_SOUND: 'off',
      }),
    ).toStrictEqual({
      photoCraftUrl: undefined,
      booths: [],
      quietMinutes: 5,
      challenge: {
        convexUrl: 'https://happy-otter-123.convex.cloud',
        token: 'tv-token',
      },
      priority: 91,
      sound: false,
    });
  });

  it.each([
    [{}, 'Set EVENT_DAY_BOOTHS'],
    [
      {
        EVENT_DAY_CHALLENGE_URL: 'https://x',
        EVENT_DAY_CHALLENGE_TOKEN: 't',
        EVENT_DAY_SOUND: 'constructor',
      },
      'on or off',
    ],
    [
      {
        EVENT_DAY_CHALLENGE_URL: 'https://x',
        EVENT_DAY_CHALLENGE_TOKEN: 't',
        EVENT_DAY_SOUND: '__proto__',
      },
      'on or off',
    ],
    [
      { EVENT_DAY_BOOTHS: 'summit-2026/main-booth' },
      'needs EVENT_DAY_PHOTOCRAFT_URL',
    ],
    [
      { EVENT_DAY_PHOTOCRAFT_URL: 'ftp://x', EVENT_DAY_BOOTHS: 'ab/cd' },
      'must be an http(s) URL',
    ],
    [
      { EVENT_DAY_PHOTOCRAFT_URL: 'not a url', EVENT_DAY_BOOTHS: 'ab/cd' },
      'must be an http(s) URL',
    ],
    [
      {
        EVENT_DAY_PHOTOCRAFT_URL: 'https://x',
        EVENT_DAY_BOOTHS: 'Summit/Main',
      },
      'event-slug/booth-slug',
    ],
    [
      { EVENT_DAY_PHOTOCRAFT_URL: 'https://x', EVENT_DAY_BOOTHS: 'a/b/c' },
      'event-slug/booth-slug',
    ],
    [{ EVENT_DAY_CHALLENGE_TOKEN: 't' }, 'together'],
    [
      {
        EVENT_DAY_CHALLENGE_URL: 'https://x',
        EVENT_DAY_CHALLENGE_TOKEN: 't',
        EVENT_DAY_PRIORITY: '101',
      },
      'from 1 to 100',
    ],
    [
      {
        EVENT_DAY_CHALLENGE_URL: 'https://x',
        EVENT_DAY_CHALLENGE_TOKEN: 't',
        EVENT_DAY_QUIET_MINUTES: '0',
      },
      'from 1 to 1440',
    ],
    [
      {
        EVENT_DAY_CHALLENGE_URL: 'https://x',
        EVENT_DAY_CHALLENGE_TOKEN: 't',
        EVENT_DAY_SOUND: 'loud',
      },
      'on or off',
    ],
  ])('rejects %j', (env, message) => {
    expect(() => loadSettings(env)).toThrow(EventSettingsError);
    expect(() => loadSettings(env)).toThrow(message);
  });
});
