import { BusyBar } from '@busy-app/busy-lib';

import type { BarConfig } from './config.ts';

/**
 * Create a busy-lib client for the configured bar. The token is sent as a
 * bearer token to the cloud proxy and as the HTTP access password over Wi-Fi.
 */
export function createBusyBar(config: BarConfig): BusyBar {
  const { addr, token, isCloud } = config;
  if (token === undefined) {
    return new BusyBar({ addr });
  }
  return new BusyBar(
    isCloud ? { addr, token } : { addr, HTTPAccessPassword: token },
  );
}
