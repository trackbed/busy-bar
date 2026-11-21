import { describe, expect, it } from 'vitest';

import { SettingsError } from '@busy-bar-apps/bar-kit';

import { IntercomSettingsError, loadSettings } from './settings.ts';

const URL = 'https://happy-otter-123.convex.cloud';

describe('loadSettings', () => {
  it('reads the deployment and the key', () => {
    expect(
      loadSettings({
        INTERCOM_CONVEX_URL: ` ${URL} `,
        INTERCOM_KEY: ' abc123 ',
      }),
    ).toStrictEqual({
      convexUrl: URL,
      key: 'abc123',
      sound: true,
      focusMinutes: 25,
    });
  });

  it('accepts a local deployment', () => {
    expect(
      loadSettings({
        INTERCOM_CONVEX_URL: 'http://127.0.0.1:3210',
        INTERCOM_KEY: 'abc123',
      }).convexUrl,
    ).toBe('http://127.0.0.1:3210');
  });

  it('asks for the deployment URL', () => {
    expect(() => loadSettings({ INTERCOM_KEY: 'abc123' })).toThrow(
      new IntercomSettingsError(
        'Set INTERCOM_CONVEX_URL to the team deployment, such as https://<name>.convex.cloud.',
      ),
    );
  });

  it.each(['happy-otter-123', 'https://happy otter.convex.cloud'])(
    'refuses a deployment URL %j',
    (convexUrl) => {
      expect(() =>
        loadSettings({
          INTERCOM_CONVEX_URL: convexUrl,
          INTERCOM_KEY: 'abc123',
        }),
      ).toThrow(
        new SettingsError(
          `INTERCOM_CONVEX_URL must be an http(s) URL; got ${JSON.stringify(convexUrl)}.`,
        ),
      );
    },
  );

  it('asks for the key', () => {
    expect(() =>
      loadSettings({ INTERCOM_CONVEX_URL: URL, INTERCOM_KEY: '  ' }),
    ).toThrow(IntercomSettingsError);
  });

  it('turns the sound off', () => {
    expect(
      loadSettings({
        INTERCOM_CONVEX_URL: URL,
        INTERCOM_KEY: 'abc123',
        INTERCOM_SOUND: ' OFF ',
      }).sound,
    ).toBe(false);
  });

  it('refuses a sound setting that is not on or off', () => {
    expect(() =>
      loadSettings({
        INTERCOM_CONVEX_URL: URL,
        INTERCOM_KEY: 'abc123',
        INTERCOM_SOUND: 'loud',
      }),
    ).toThrow(
      new SettingsError('INTERCOM_SOUND must be on or off; got "loud".'),
    );
  });

  it('reads how long a team focus lasts', () => {
    expect(
      loadSettings({
        INTERCOM_CONVEX_URL: URL,
        INTERCOM_KEY: 'abc123',
        INTERCOM_FOCUS_MINUTES: ' 50 ',
      }).focusMinutes,
    ).toBe(50);
  });

  it.each(['4', '1441', '25.5', '1e2', 'half an hour'])(
    'refuses a team focus of %j minutes',
    (minutes) => {
      expect(() =>
        loadSettings({
          INTERCOM_CONVEX_URL: URL,
          INTERCOM_KEY: 'abc123',
          INTERCOM_FOCUS_MINUTES: minutes,
        }),
      ).toThrow(
        new SettingsError(
          `INTERCOM_FOCUS_MINUTES must be a whole number from 5 to 1440; got ${JSON.stringify(minutes)}.`,
        ),
      );
    },
  );
});
