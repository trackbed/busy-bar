/** The address a BUSY Bar answers on when it is plugged in over USB. */
export const USB_ADDRESS = '10.0.4.20';

/** The BUSY cloud proxy, which reaches a bar from anywhere with an API token. */
export const CLOUD_ADDRESS = 'https://api.busy.app';

const CLOUD_HOST = 'api.busy.app';

/**
 * How an app reaches its BUSY Bar. {@link loadBarConfig} reads it from the
 * environment, using the same variables as the Python kit (`bar_kit`).
 */
export interface BarConfig {
  /** IP address, host name, or URL of the bar, or {@link CLOUD_ADDRESS}. */
  readonly addr: string;
  /**
   * The bar's Wi-Fi HTTP access password, or a cloud API token when
   * {@link BarConfig.isCloud} is true. USB connections need neither.
   */
  readonly token: string | undefined;
  /** Whether {@link BarConfig.addr} points at the BUSY cloud proxy. */
  readonly isCloud: boolean;
}

/** Thrown when the environment describes a connection that cannot work. */
export class BarConfigError extends Error {
  override readonly name = 'BarConfigError';
}

/**
 * Read the connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`.
 * Without `BUSYBAR_ADDR`, apps talk to a bar plugged in over USB.
 */
export function loadBarConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BarConfig {
  const addr = env['BUSYBAR_ADDR']?.trim() || USB_ADDRESS;
  const token = env['BUSYBAR_TOKEN']?.trim() || undefined;
  const isCloud = isCloudAddress(addr);

  if (isCloud && token === undefined) {
    throw new BarConfigError(
      `BUSYBAR_TOKEN is required when BUSYBAR_ADDR is the BUSY cloud (${CLOUD_ADDRESS}). ` +
        'Create a token at https://cloud.busy.app/api-tokens.',
    );
  }

  return { addr, token, isCloud };
}

/** Whether an address, with or without a protocol, is the BUSY cloud proxy. */
export function isCloudAddress(addr: string): boolean {
  const url = /^[a-z][a-z\d+.-]*:\/\//i.test(addr) ? addr : `http://${addr}`;
  try {
    return new URL(url).hostname.toLowerCase() === CLOUD_HOST;
  } catch {
    throw new BarConfigError(
      `BUSYBAR_ADDR must be an IP address, host name, or URL; got ${JSON.stringify(addr)}.`,
    );
  }
}
