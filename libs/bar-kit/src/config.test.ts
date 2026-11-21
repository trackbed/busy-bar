import { describe, expect, it } from 'vitest';

import { ADDRESSES } from './__tests__/contract.ts';
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

const accepted = ADDRESSES.flatMap(([addr, cloud]) =>
  cloud === undefined ? [] : [[addr, cloud] as const],
);
const refused = ADDRESSES.flatMap(([addr, cloud]) =>
  cloud === undefined ? [addr] : [],
);

describe('isCloudAddress', () => {
  it('has the shared cases to check', () => {
    expect(accepted.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
  });

  it.each(accepted)('classifies %j as cloud: %s', (addr, cloud) => {
    expect(isCloudAddress(addr)).toBe(cloud);
  });

  it.each(refused)('refuses %j', (addr) => {
    expect(() => isCloudAddress(addr)).toThrow(BarConfigError);
  });
});
