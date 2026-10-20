import { describe, expect, it } from 'vitest';

import {
  BarConfigError,
  CLOUD_ADDRESS,
  isCloudAddress,
  loadBarConfig,
  USB_ADDRESS,
} from './config.ts';

describe('loadBarConfig', () => {
  it('defaults to a bar plugged in over USB', () => {
    expect(loadBarConfig({})).toEqual({
      addr: USB_ADDRESS,
      token: undefined,
      isCloud: false,
    });
  });

  it('reads a Wi-Fi address and its HTTP access password', () => {
    expect(
      loadBarConfig({ BUSYBAR_ADDR: ' 192.168.1.20 ', BUSYBAR_TOKEN: '1234' }),
    ).toEqual({ addr: '192.168.1.20', token: '1234', isCloud: false });
  });

  it('treats blank variables as unset', () => {
    expect(loadBarConfig({ BUSYBAR_ADDR: '  ', BUSYBAR_TOKEN: '' })).toEqual({
      addr: USB_ADDRESS,
      token: undefined,
      isCloud: false,
    });
  });

  it('accepts the cloud proxy with a token', () => {
    expect(
      loadBarConfig({ BUSYBAR_ADDR: CLOUD_ADDRESS, BUSYBAR_TOKEN: 'secret' }),
    ).toEqual({ addr: CLOUD_ADDRESS, token: 'secret', isCloud: true });
  });

  it('rejects the cloud proxy without a token', () => {
    expect(() => loadBarConfig({ BUSYBAR_ADDR: CLOUD_ADDRESS })).toThrow(
      BarConfigError,
    );
  });
});

describe('isCloudAddress', () => {
  it.each([
    ['https://api.busy.app', true],
    ['api.busy.app', true],
    ['HTTPS://API.BUSY.APP/', true],
    ['10.0.4.20', false],
    ['http://192.168.1.20', false],
    ['busybar.local', false],
  ])('classifies %s as cloud: %s', (addr, expected) => {
    expect(isCloudAddress(addr)).toBe(expected);
  });

  it('rejects addresses that are not host names or URLs', () => {
    expect(() => isCloudAddress('http://')).toThrow(BarConfigError);
  });
});
