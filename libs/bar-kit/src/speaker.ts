import type { AudioPlayParams, RequestOptions } from '@busy-app/busy-lib';

/**
 * The sounds every bar ships, by the names busylib gives them in Python
 * (`STOCK_SOUNDS`), so both kits name them alike.
 */
export const STOCK_SOUNDS = {
  event: 'shared/sounds/calendar_event_starts.snd',
  reminder: 'shared/sounds/calendar_reminder_ends.snd',
  volume: 'shared/sounds/volume_change.snd',
} as const;

export type StockSound = keyof typeof STOCK_SOUNDS;

/**
 * The part of the busy-lib `BusyBar` client that {@link createSpeaker} uses.
 * Declared structurally for the same reason as `BarDisplayClient`.
 */
export interface BarAudioClient {
  AudioPlay(
    params: AudioPlayParams,
    options?: RequestOptions,
  ): Promise<unknown>;
}

export interface SpeakerOptions {
  /** The `application_name` the sounds play under, and the log prefix. */
  readonly name: string;
  readonly client: BarAudioClient;
  /** With sounds off, `play` does nothing. */
  readonly enabled: boolean;
  /**
   * Cancels sounds still waiting on the bar and silences later ones, so a
   * bar that never answers cannot hold up shutdown; see `shutdownSignal`.
   */
  readonly signal?: AbortSignal;
  readonly log?: Pick<Console, 'warn'>;
}

/** Plays the bar's stock sounds for an app's alerts. */
export interface Speaker {
  /**
   * Start playing `sound` and return at once, so a slow or absent bar never
   * holds up a poll or an input handler. A sound that fails is logged and
   * never throws.
   */
  readonly play: (sound: StockSound) => void;
  /** Wait for sounds already started; tests use it to settle. */
  readonly wait: () => Promise<void>;
}

export function createSpeaker(options: SpeakerOptions): Speaker {
  const {
    name,
    client,
    enabled,
    signal = new AbortController().signal,
    log = console,
  } = options;
  const pending = new Set<Promise<void>>();

  const attempt = async (path: string): Promise<void> => {
    try {
      await client.AudioPlay(
        { application_name: name, stock_path: path },
        { signal },
      );
    } catch (error) {
      // An abort is the shutdown, not a failure worth logging.
      if (!signal.aborted) {
        log.warn(`[${name}] Playing ${path} failed:`, error);
      }
    }
  };

  return {
    play: (sound) => {
      if (!enabled || signal.aborted) {
        return;
      }
      const playing = attempt(STOCK_SOUNDS[sound]).finally(() => {
        pending.delete(playing);
      });
      pending.add(playing);
    },
    wait: async () => {
      await Promise.all(pending);
    },
  };
}
