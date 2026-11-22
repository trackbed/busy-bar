import { describe, expect, it } from 'vitest';

import { envHttpUrl, envSwitch, envWholeNumber, SettingsError } from './env.ts';

describe('envSwitch', () => {
  it('is on when unset or blank', () => {
    expect(envSwitch({}, 'SOUND')).toBe(true);
    expect(envSwitch({ SOUND: '  ' }, 'SOUND')).toBe(true);
  });

  it('reads on and off in any case', () => {
    expect(envSwitch({ SOUND: ' OFF ' }, 'SOUND')).toBe(false);
    expect(envSwitch({ SOUND: 'On' }, 'SOUND')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(() => envSwitch({ SOUND: 'Loud' }, 'SOUND')).toThrow(
      new SettingsError('SOUND must be on or off; got "loud".'),
    );
  });
});

describe('envWholeNumber', () => {
  const minutes = { fallback: 15, min: 1, max: 60 };

  it('falls back when unset or blank', () => {
    expect(envWholeNumber({}, 'MINUTES', minutes)).toBe(15);
    expect(envWholeNumber({ MINUTES: ' ' }, 'MINUTES', minutes)).toBe(15);
  });

  it('reads decimal digits within the bounds', () => {
    expect(envWholeNumber({ MINUTES: ' 1 ' }, 'MINUTES', minutes)).toBe(1);
    expect(envWholeNumber({ MINUTES: '060' }, 'MINUTES', minutes)).toBe(60);
  });

  it.each(['0', '61', '-5', '+5', '5.0', '1e1', '0x10', '1_0', 'ten', '١٢'])(
    'refuses %j',
    (raw) => {
      expect(() =>
        envWholeNumber({ MINUTES: raw }, 'MINUTES', minutes),
      ).toThrow(
        new SettingsError(
          `MINUTES must be a whole number from 1 to 60; got ${JSON.stringify(raw)}.`,
        ),
      );
    },
  );

  it('names only the lower bound without an upper one', () => {
    expect(() =>
      envWholeNumber({ MINUTES: '0' }, 'MINUTES', { fallback: 15, min: 1 }),
    ).toThrow(
      new SettingsError(
        'MINUTES must be a whole number of at least 1; got "0".',
      ),
    );
  });

  it('names no bound when any whole number goes', () => {
    const anything = { fallback: 3, min: 0 };

    expect(envWholeNumber({ LOW: '0' }, 'LOW', anything)).toBe(0);
    expect(() => envWholeNumber({ LOW: '-1' }, 'LOW', anything)).toThrow(
      new SettingsError('LOW must be a whole number; got "-1".'),
    );
  });

  it('refuses a number too large to hold exactly', () => {
    expect(() =>
      envWholeNumber({ LOW: '9007199254740993' }, 'LOW', {
        fallback: 3,
        min: 0,
      }),
    ).toThrow(SettingsError);
  });
});

describe('envHttpUrl', () => {
  it('is undefined when unset or blank', () => {
    expect(envHttpUrl({}, 'URL')).toBeUndefined();
    expect(envHttpUrl({ URL: ' ' }, 'URL')).toBeUndefined();
  });

  it.each([
    'https://happy-otter-123.convex.cloud',
    'http://127.0.0.1:3210',
    'HTTPS://example.com/a b',
    'http://localhost:8080?x=1',
    'http://[::1]:3210/api',
  ])('reads %j as written', (url) => {
    expect(envHttpUrl({ URL: ` ${url} ` }, 'URL')).toBe(url);
  });

  it.each([
    'happy-otter-123',
    'ftp://example.com',
    'https:example.com',
    'http://',
    'https://a b',
    'https://example.com:99999',
    'http://exa<mple.com',
    'http://a|b.com',
    'http://ex^ample.com',
    'http://exa%20mple.com',
    'http://1.2.3.999',
    'http://127.1',
    'http://-example.com',
    'http://example..com',
    'http://user@example.com',
    'http://example.com:',
    'http://[::g]',
    'http://\u212aelvin.com',
    '\u017fttp://example.com',
  ])('refuses %j', (raw) => {
    expect(() => envHttpUrl({ URL: raw }, 'URL')).toThrow(
      new SettingsError(
        `URL must be an http(s) URL; got ${JSON.stringify(raw)}.`,
      ),
    );
  });
});
