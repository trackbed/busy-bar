// The error the bar's API answers with. The device's rules throw it, and the
// HTTP server turns it into the firmware's error response.

/** A request the API refuses, answered as the firmware does. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
