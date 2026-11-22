import { describe, expect, it, vi } from 'vitest';

import { bodyOf } from './__tests__/fixtures.ts';
import type { BoothRef } from './photocraft.ts';
import { GALLERY_LIMIT, PhotoCraft, PhotoCraftError } from './photocraft.ts';

const APP = 'https://photos.example.com/';
const BOOTH: BoothRef = { eventSlug: 'summit-2026', boothSlug: 'main-booth' };
const NOW = Date.parse('2026-10-20T10:00:00Z');
const MINUTE = 60_000;

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake PhotoCraft that answers token and gallery requests from queues. */
function photoCraft({
  tokens = [],
  galleries = [],
}: {
  tokens?: Reply[];
  galleries?: Reply[];
}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    const queue = url.includes('/api/photo-craft-token') ? tokens : galleries;
    const reply = queue.shift() ?? { status: 500 };
    const body =
      reply.body === undefined ? 'not json' : JSON.stringify(reply.body);
    return Promise.resolve(new Response(body, { status: reply.status }));
  });
  let now = NOW;
  const log = { warn: vi.fn<Console['warn']>() };
  const client = new PhotoCraft({
    name: 'test',
    appUrl: APP,
    fetch,
    now: () => new Date(now),
    log,
  });
  return {
    client,
    calls,
    log,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const TOKEN: Reply = {
  status: 200,
  body: {
    token: 'photo_craft_v1.abc.sig',
    boothId: 'booth-123',
    expiresAtMs: NOW + 30 * MINUTE,
  },
};

function gallery(createdAt: string[], version = 'v1'): Reply {
  return {
    status: 200,
    body: {
      images: createdAt.map((time, index) => ({
        id: `p${index}`,
        createdAt: time,
        origin: 'api',
      })),
      error: null,
      galleryVersion: version,
      unchanged: false,
    },
  };
}

const signal = new AbortController().signal;

describe('PhotoCraft', () => {
  it('mints a wall token and reads the booth’s newest portraits', async () => {
    const { client, calls } = photoCraft({
      tokens: [TOKEN],
      galleries: [
        gallery(['2026-10-20T09:58:00Z', '2026-10-20T09:59:30Z', 'bad']),
      ],
    });

    const status = await client.status(BOOTH, signal);

    expect(status).toStrictEqual({
      booth: BOOTH,
      state: 'live',
      photos: 3,
      latestPhotoAt: new Date('2026-10-20T09:59:30Z'),
      problem: undefined,
    });
    expect(calls[0]?.url).toBe(
      'https://photos.example.com/api/photo-craft-token',
    );
    expect(bodyOf(calls[0]?.init)).toStrictEqual({
      purpose: 'wall',
      eventSlug: 'summit-2026',
      boothSlug: 'main-booth',
    });
    expect(calls[1]?.url).toBe(
      `https://photos.example.com/api/photo-craft?boothId=booth-123&limit=${GALLERY_LIMIT}`,
    );
    expect(calls[1]?.init?.headers).toStrictEqual({
      authorization: 'Bearer photo_craft_v1.abc.sig',
    });
  });

  it('keeps the token and sends the gallery version back', async () => {
    const { client, calls } = photoCraft({
      tokens: [TOKEN],
      galleries: [
        gallery(['2026-10-20T09:59:00Z'], 'v7'),
        {
          status: 200,
          body: { images: [], galleryVersion: 'v7', unchanged: true },
        },
      ],
    });

    const first = await client.status(BOOTH, signal);
    const second = await client.status(BOOTH, signal);

    expect(second).toBe(first);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toContain('galleryVersion=v7');
  });

  it.each<Reply>([
    { status: 502 },
    { status: 404 },
    { status: 200, body: [] },
    { status: 200 },
  ])(
    'preserves the gallery through an unsuccessful response %j',
    async (failure) => {
      const { client, calls } = photoCraft({
        tokens: [TOKEN],
        galleries: [
          gallery(['2026-10-20T09:59:00Z'], 'v7'),
          failure,
          {
            status: 200,
            body: { images: [], galleryVersion: 'v7', unchanged: true },
          },
        ],
      });

      const first = await client.status(BOOTH, signal);
      expect((await client.status(BOOTH, signal)).state).not.toBe('live');
      const recovered = await client.status(BOOTH, signal);

      expect(recovered).toBe(first);
      expect(recovered.photos).toBe(1);
      expect(recovered.latestPhotoAt).toStrictEqual(
        new Date('2026-10-20T09:59:00Z'),
      );
      expect(calls[3]?.url).toContain('galleryVersion=v7');
    },
  );

  it('renews the token shortly before it expires', async () => {
    const { client, calls, advance } = photoCraft({
      tokens: [TOKEN, TOKEN],
      galleries: [gallery([]), gallery([])],
    });

    await client.status(BOOTH, signal);
    advance(29 * MINUTE);
    await client.status(BOOTH, signal);

    expect(
      calls.filter((call) => call.url.includes('photo-craft-token')),
    ).toHaveLength(2);
  });

  it('reads a paused booth as off and waits before minting again', async () => {
    const { client, calls, advance } = photoCraft({
      tokens: [{ status: 403, body: { error: 'Booth is not active.' } }, TOKEN],
      galleries: [gallery([])],
    });

    expect((await client.status(BOOTH, signal)).state).toBe('off');
    advance(4 * MINUTE);
    expect((await client.status(BOOTH, signal)).state).toBe('off');
    expect(calls).toHaveLength(1);

    advance(MINUTE);
    expect((await client.status(BOOTH, signal)).state).toBe('live');
  });

  it('reads an unknown booth as missing', async () => {
    const { client } = photoCraft({
      tokens: [{ status: 404, body: { error: 'Booth was not found.' } }],
    });

    expect((await client.status(BOOTH, signal)).state).toBe('missing');
  });

  it('backs off as long as the rate limit says', async () => {
    const { client, calls, advance } = photoCraft({
      tokens: [
        {
          status: 429,
          body: { error: 'Too many requests. Try again in 20 seconds.' },
        },
        TOKEN,
      ],
      galleries: [gallery([])],
    });

    const limited = await client.status(BOOTH, signal);
    advance(19_000);
    await client.status(BOOTH, signal);

    expect(limited).toMatchObject({
      state: 'error',
      problem: 'rate limited',
    });
    expect(calls).toHaveLength(1);
    advance(1000);
    expect((await client.status(BOOTH, signal)).state).toBe('live');
  });

  it('falls back to a minute when the rate limit gives no time', async () => {
    const { client, calls, advance } = photoCraft({
      tokens: [{ status: 429 }, TOKEN],
      galleries: [gallery([])],
    });

    await client.status(BOOTH, signal);
    advance(59_000);
    await client.status(BOOTH, signal);

    expect(calls).toHaveLength(1);
  });

  it('reads a booth paused after minting as off and keeps its token', async () => {
    const { client, calls } = photoCraft({
      tokens: [TOKEN],
      galleries: [
        {
          status: 404,
          body: { images: [], error: 'This booth is not active.' },
        },
        gallery([]),
      ],
    });

    expect((await client.status(BOOTH, signal)).state).toBe('off');
    expect((await client.status(BOOTH, signal)).state).toBe('live');
    expect(calls).toHaveLength(3);
  });

  it('drops a rejected token and mints a new one on the next poll', async () => {
    const { client, calls } = photoCraft({
      tokens: [TOKEN, TOKEN],
      galleries: [
        gallery(['2026-10-20T09:00:00Z']),
        { status: 401 },
        gallery([]),
      ],
    });

    const live = await client.status(BOOTH, signal);
    expect(await client.status(BOOTH, signal)).toBe(live);
    await client.status(BOOTH, signal);

    expect(
      calls.map((call) => call.url.includes('photo-craft-token')),
    ).toStrictEqual([true, false, false, true, false]);
  });

  it.each([
    [{ tokens: [{ status: 500 }] }, 'answered 500'],
    [{ tokens: [{ status: 200, body: { token: 'x' } }] }, 'no wall token'],
    [{ tokens: [TOKEN], galleries: [{ status: 502 }] }, 'answered 502'],
    [
      { tokens: [TOKEN], galleries: [{ status: 200, body: [] }] },
      'unexpected answer',
    ],
  ])('reports and logs what went wrong (%#)', async (replies, problem) => {
    const { client, log } = photoCraft(replies);

    expect(await client.status(BOOTH, signal)).toMatchObject({
      state: 'error',
      problem,
    });
    expect(log.warn).toHaveBeenCalledWith(
      '[test] Reading PhotoCraft booth summit-2026/main-booth failed:',
      new PhotoCraftError(problem),
    );
  });

  it('turns a network failure into an error status', async () => {
    const failure = new TypeError('fetch failed');
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.reject(failure));
    const log = { warn: vi.fn<Console['warn']>() };

    const status = await new PhotoCraft({
      name: 'test',
      appUrl: APP,
      fetch,
      log,
    }).status(BOOTH, signal);

    expect(status).toMatchObject({ state: 'error', problem: 'fetch failed' });
    expect(log.warn).toHaveBeenCalledWith(
      '[test] Reading PhotoCraft booth summit-2026/main-booth failed:',
      failure,
    );
  });

  it('lets an abort through', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });

    const log = { warn: vi.fn<Console['warn']>() };

    await expect(
      new PhotoCraft({ name: 'test', appUrl: APP, fetch, log }).status(
        BOOTH,
        controller.signal,
      ),
    ).rejects.toThrow('aborted');
    expect(log.warn).not.toHaveBeenCalled();
  });
});
