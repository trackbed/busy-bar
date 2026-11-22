/**
 * Readers for the settings apps take from the environment. Each treats an
 * unset or blank variable as its default and throws a {@link SettingsError}
 * naming the variable and the value it refused. The Python kit (`bar_kit`)
 * applies the same rules with the same messages, quoting the value its own
 * way.
 */

import { isIPv6 } from 'node:net';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The environment does not describe an app that can run. Each app's own
 * settings error extends it.
 */
export class SettingsError extends Error {
  override readonly name: string = 'SettingsError';
}

/** `on` or `off`, in any case; unset means on. */
export function envSwitch(env: Env, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase() || 'on';
  if (raw !== 'on' && raw !== 'off') {
    throw new SettingsError(
      `${name} must be on or off; got ${JSON.stringify(raw)}.`,
    );
  }
  return raw === 'on';
}

export interface WholeNumberOptions {
  /** The value when the variable is unset or blank. */
  readonly fallback: number;
  readonly min: number;
  /** The largest value allowed; unbounded without one. */
  readonly max?: number;
}

/**
 * A whole number written in decimal digits only, from `min` to `max`. Signs,
 * decimal points, exponents, and hexadecimal are refused.
 */
export function envWholeNumber(
  env: Env,
  name: string,
  { fallback, min, max }: WholeNumberOptions,
): number {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (
    !/^[0-9]+$/u.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    const range =
      max !== undefined
        ? ` from ${min} to ${max}`
        : min > 0
          ? ` of at least ${min}`
          : '';
    throw new SettingsError(
      `${name} must be a whole number${range}; got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}

// Explicit ASCII classes: a case-insensitive Unicode pattern would let the
// Kelvin sign match `k` and the long s match `s`.
const HTTP_URL =
  /^[Hh][Tt][Tt][Pp][Ss]?:\/\/(?<host>[^/?#:[\]]+|\[[0-9A-Fa-f:.]+\])(?::(?<port>[0-9]+))?(?:[/?#][\s\S]*)?$/u;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;
const OCTET = /^(?:0|[1-9][0-9]{0,2})$/u;

/**
 * An absolute `http://` or `https://` URL, as written, or `undefined` when
 * the variable is unset or blank. The host is a name of letters, digits, and
 * hyphens, a dotted IPv4 address, or a bracketed IPv6 address; a port, when
 * given, runs from 0 to 65535. User info is refused.
 */
export function envHttpUrl(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    return undefined;
  }
  const parts = HTTP_URL.exec(raw)?.groups;
  const host = parts?.['host'];
  const port = parts?.['port'];
  if (
    host === undefined ||
    !isValidHost(host) ||
    (port !== undefined && Number(port) > 65_535)
  ) {
    throw new SettingsError(
      `${name} must be an http(s) URL; got ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function isValidHost(host: string): boolean {
  if (host.startsWith('[')) {
    return isIPv6(host.slice(1, -1));
  }
  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) {
    return false;
  }
  // A name ending in a number is an IPv4 address and must be a dotted quad.
  return (
    !/^[0-9]+$/u.test(labels.at(-1) ?? '') ||
    (labels.length === 4 &&
      labels.every((label) => OCTET.test(label) && Number(label) <= 255))
  );
}
