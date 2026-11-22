export interface GetJsonOptions {
  /** Names the service in the error, such as `DMI`. */
  readonly service: string;
  /** The error a refusal throws, such as `DmiError`. */
  readonly error: new (message: string) => Error;
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
}

/**
 * GET `url` and return its JSON body. A response that is not OK throws
 * `<service> answered <status> <statusText>` as `options.error`.
 */
export async function getJson(
  url: string,
  options: GetJsonOptions,
): Promise<unknown> {
  const response = await options.fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new options.error(
      `${options.service} answered ${response.status} ${response.statusText}`.trim(),
    );
  }
  return response.json();
}
