import { describe, expect, it } from 'vitest';

import { ClockSettingsError, loadSettings } from './settings.ts';

describe('loadSettings', () => {
  it('uses the system time zone when unset or blank', () => {
    expect(loadSettings({})).toStrictEqual({ timeZone: undefined });
    expect(loadSettings({ CLOCK_TIME_ZONE: '  ' })).toStrictEqual({
      timeZone: undefined,
    });
  });

  it('reads an IANA time zone', () => {
    expect(
      loadSettings({ CLOCK_TIME_ZONE: ' Europe/Copenhagen ' }),
    ).toStrictEqual({ timeZone: 'Europe/Copenhagen' });
  });

  it('refuses a zone Intl does not know', () => {
    expect(() => loadSettings({ CLOCK_TIME_ZONE: 'Mars/Olympus' })).toThrow(
      new ClockSettingsError(
        'CLOCK_TIME_ZONE must be an IANA time zone such as Europe/Copenhagen; got "Mars/Olympus".',
      ),
    );
  });
});
