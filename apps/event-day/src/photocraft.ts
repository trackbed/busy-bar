import {
  arrayAt,
  isObject,
  numberAt,
  stringAt,
} from '@busy-bar-apps/json-values';

/** One booth, as its public URL names it: `/e/<eventSlug>/<boothSlug>`. */
export interface BoothRef {
  readonly eventSlug: string;
  readonly boothSlug: string;
}

/**
 * - `live`: the booth publishes to its wall.
 * - `off`: the booth or its event is paused or not active.
 * - `missing`: PhotoCraft does not know the booth.
 * - `error`: PhotoCraft could not be reached or answered unexpectedly.
 */
export type BoothState = 'live' | 'off' | 'missing' | 'error';

export interface BoothStatus {
  readonly booth: BoothRef;
  readonly state: BoothState;
  /** Portraits on the wall, counted up to {@link GALLERY_LIMIT}. */
  readonly photos: number | undefined;
  readonly latestPhotoAt: Date | undefined;
  /** What went wrong, for `error`. */
  readonly problem: string | undefined;
}

/** The most portraits one gallery request returns. */
export const GALLERY_LIMIT = 200;

// Minting shares a deployment-wide rate limit with every kiosk, so the app
// keeps each token until shortly before it expires and backs off when told.
const RENEW_BEFORE_MS = 60_000;
const INACTIVE_RETRY_MS = 5 * 60_000;
const MISSING_RETRY_MS = 15 * 60_000;
const RATE_LIMIT_RETRY_MS = 60_000;

interface WallToken {
  readonly token: string;
  readonly boothId: string;
  readonly expiresAt: number;
}

interface BoothMemory {
  token: WallToken | undefined;
  retryMintAt: number;
  galleryVersion: string | undefined;
  last: BoothStatus | undefined;
}

export interface PhotoCraftOptions {
  /** The PhotoCraft app URL; both routes live under its `/api`. */
  readonly appUrl: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Reads booths through PhotoCraft's public wall routes: a wall token from
 * `POST /api/photo-craft-token`, then the newest portraits from
 * `GET /api/photo-craft?boothId=`. No login is involved; these are the routes
 * the live wall itself uses.
 */
export class PhotoCraft {
  readonly #appUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #memory = new Map<string, BoothMemory>();

  constructor(options: PhotoCraftOptions) {
    this.#appUrl = options.appUrl.replace(/\/+$/u, '');
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  /** The booth's state now. Never rejects; failures become `error`. */
  async status(booth: BoothRef, signal: AbortSignal): Promise<BoothStatus> {
    const memory = this.#remember(booth);
    try {
      const status = await this.#read(booth, memory, signal);
      memory.last = status;
      return status;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const status = blank(
        booth,
        'error',
        error instanceof Error ? error.message : String(error),
      );
      memory.last = status;
      return status;
    }
  }

  async #read(
    booth: BoothRef,
    memory: BoothMemory,
    signal: AbortSignal,
  ): Promise<BoothStatus> {
    const now = this.#now().getTime();
    if (
      memory.token === undefined ||
      memory.token.expiresAt - RENEW_BEFORE_MS <= now
    ) {
      memory.token = undefined;
      if (now < memory.retryMintAt) {
        return memory.last ?? blank(booth, 'off');
      }
      const minted = await this.#mint(booth, memory, signal);
      if (minted !== undefined) {
        return minted;
      }
    }
    return this.#gallery(booth, memory, signal);
  }

  /** Get a wall token, or the status that explains why there is none. */
  async #mint(
    booth: BoothRef,
    memory: BoothMemory,
    signal: AbortSignal,
  ): Promise<BoothStatus | undefined> {
    const response = await this.#fetch(
      `${this.#appUrl}/api/photo-craft-token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'wall', ...booth }),
        signal,
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    const now = this.#now().getTime();
    switch (response.status) {
      case 200: {
        memory.token = readToken(body);
        return undefined;
      }
      case 403: {
        memory.retryMintAt = now + INACTIVE_RETRY_MS;
        return blank(booth, 'off');
      }
      case 404: {
        memory.retryMintAt = now + MISSING_RETRY_MS;
        return blank(booth, 'missing');
      }
      case 429: {
        memory.retryMintAt = now + retryAfter(body);
        return (
          memory.last ??
          blank(booth, 'error', 'PhotoCraft is rate limiting tokens')
        );
      }
      default: {
        return blank(booth, 'error', `PhotoCraft answered ${response.status}`);
      }
    }
  }

  async #gallery(
    booth: BoothRef,
    memory: BoothMemory,
    signal: AbortSignal,
  ): Promise<BoothStatus> {
    const token = memory.token;
    if (token === undefined) {
      return blank(booth, 'error', 'PhotoCraft sent no wall token');
    }
    const query = new URLSearchParams({
      boothId: token.boothId,
      limit: String(GALLERY_LIMIT),
    });
    if (memory.galleryVersion !== undefined) {
      query.set('galleryVersion', memory.galleryVersion);
    }
    const response = await this.#fetch(
      `${this.#appUrl}/api/photo-craft?${query.toString()}`,
      {
        headers: { authorization: `Bearer ${token.token}` },
        signal,
      },
    );
    if (response.status === 404) {
      return blank(booth, 'off');
    }
    if (response.status === 401) {
      // Expired or revoked: mint a fresh token on the next poll.
      memory.token = undefined;
      return memory.last ?? blank(booth, 'off');
    }
    if (!response.ok) {
      return blank(booth, 'error', `PhotoCraft answered ${response.status}`);
    }
    const body: unknown = await response.json();
    if (!isObject(body)) {
      return blank(booth, 'error', 'PhotoCraft sent something unexpected');
    }
    memory.galleryVersion = stringAt(body, 'galleryVersion');
    if (body['unchanged'] === true && memory.last?.state === 'live') {
      return memory.last;
    }
    const times = arrayAt(body, 'images').flatMap((image) => {
      const createdAt = isObject(image)
        ? stringAt(image, 'createdAt')
        : undefined;
      const time = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
      return Number.isNaN(time) ? [] : [time];
    });
    return {
      booth,
      state: 'live',
      photos: arrayAt(body, 'images').length,
      latestPhotoAt:
        times.length === 0 ? undefined : new Date(Math.max(...times)),
      problem: undefined,
    };
  }

  #remember(booth: BoothRef): BoothMemory {
    const key = `${booth.eventSlug}/${booth.boothSlug}`;
    let memory = this.#memory.get(key);
    if (memory === undefined) {
      memory = {
        token: undefined,
        retryMintAt: 0,
        galleryVersion: undefined,
        last: undefined,
      };
      this.#memory.set(key, memory);
    }
    return memory;
  }
}

function readToken(body: unknown): WallToken | undefined {
  if (!isObject(body)) {
    return undefined;
  }
  const token = stringAt(body, 'token');
  const boothId = stringAt(body, 'boothId');
  const expiresAt = numberAt(body, 'expiresAtMs');
  return token === undefined || boothId === undefined || expiresAt === undefined
    ? undefined
    : { token, boothId, expiresAt };
}

/** PhotoCraft says `Too many requests. Try again in N seconds.` */
function retryAfter(body: unknown): number {
  const message = isObject(body) ? (stringAt(body, 'error') ?? '') : '';
  const seconds = /in (\d+) seconds?/u.exec(message)?.[1];
  return seconds === undefined ? RATE_LIMIT_RETRY_MS : Number(seconds) * 1000;
}

function blank(
  booth: BoothRef,
  state: BoothState,
  problem?: string,
): BoothStatus {
  return { booth, state, photos: undefined, latestPhotoAt: undefined, problem };
}
