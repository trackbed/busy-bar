import type { AudioPlayParams, RequestOptions } from '@busy-app/busy-lib';
import { describe, expect, it, vi } from 'vitest';

import type { BarAudioClient, SpeakerOptions } from './speaker.ts';
import { createSpeaker, STOCK_SOUNDS } from './speaker.ts';

/** A bar that answers each sound when `answer` is called. */
function fakeBar() {
  const answers: ((failure?: Error) => void)[] = [];
  const AudioPlay = vi.fn<BarAudioClient['AudioPlay']>(
    (_params: AudioPlayParams, options?: RequestOptions) =>
      new Promise((resolve, reject) => {
        answers.push((failure) => {
          if (failure === undefined) {
            resolve({ result: 'OK' });
          } else {
            reject(failure);
          }
        });
        options?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
  );
  const answer = (failure?: Error): void => {
    for (const reply of answers.splice(0)) {
      reply(failure);
    }
  };
  return { client: { AudioPlay } satisfies BarAudioClient, answer };
}

function setup(overrides: Partial<SpeakerOptions> = {}) {
  const bar = fakeBar();
  const log = { warn: vi.fn<Console['warn']>() };
  const speaker = createSpeaker({
    name: 'test',
    client: bar.client,
    enabled: true,
    log,
    ...overrides,
  });
  return { ...bar, log, speaker };
}

describe('createSpeaker', () => {
  it('plays the stock path under the app name', async () => {
    const { client, answer, speaker } = setup();

    speaker.play('event');
    speaker.play('reminder');
    answer();
    await speaker.wait();

    expect(client.AudioPlay.mock.calls.map((call) => call[0])).toStrictEqual([
      { application_name: 'test', stock_path: STOCK_SOUNDS.event },
      { application_name: 'test', stock_path: STOCK_SOUNDS.reminder },
    ]);
  });

  it('stays silent when disabled', async () => {
    const { client, speaker } = setup({ enabled: false });

    speaker.play('event');
    await speaker.wait();

    expect(client.AudioPlay).not.toHaveBeenCalled();
  });

  it('returns before the bar answers', async () => {
    const { client, answer, speaker } = setup();
    let settled = false;

    speaker.play('event');
    void speaker.wait().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(client.AudioPlay).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    answer();
    await speaker.wait();
    expect(settled).toBe(true);
  });

  it('logs a sound that fails without throwing', async () => {
    const { answer, log, speaker } = setup();
    const failure = new Error('speaker busy');

    speaker.play('reminder');
    answer(failure);
    await speaker.wait();

    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      `[test] Playing ${STOCK_SOUNDS.reminder} failed:`,
      failure,
    );
  });

  it('cancels a sound on shutdown, quietly, and plays none after it', async () => {
    const controller = new AbortController();
    const { client, log, speaker } = setup({ signal: controller.signal });

    speaker.play('event');
    controller.abort();
    await speaker.wait();
    speaker.play('event');

    expect(client.AudioPlay).toHaveBeenCalledOnce();
    expect(client.AudioPlay.mock.calls[0]?.[1]).toStrictEqual({
      signal: controller.signal,
    });
    expect(log.warn).not.toHaveBeenCalled();
  });
});
