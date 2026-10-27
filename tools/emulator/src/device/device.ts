// The emulated bar: its screen, settings, speaker, and buttons, and the
// events the page and the status stream follow.

import type { AssetLibrary } from '../assets/library.ts';
import type { Sound } from '../formats/sound.ts';
import type { Rgba } from '../render/canvas.ts';
import { ApiError } from '../server/http.ts';
import type { InputEvent } from '../server/protobuf.ts';
import type { BusySnapshot } from './busy-timer.ts';
import {
  INITIAL_SNAPSHOT,
  parseBusySnapshot,
  startedTimer,
  stoppedTimer,
  stopsAt,
} from './busy-timer.ts';
import type { AssetSource } from './elements.ts';
import { devicePath, parseDrawRequest } from './elements.ts';
import { IDLE_PRIORITY, Screen, TIMER_PRIORITY } from './screen.ts';

/** The keys `POST /api/input` and the page's buttons press. */
export const KEYS = [
  'up',
  'down',
  'ok',
  'back',
  'start',
  'busy',
  'custom',
  'off',
  'apps',
  'settings',
] as const;
export type Key = (typeof KEYS)[number];

export type DeviceEvent =
  | { readonly type: 'changed' }
  | { readonly type: 'input'; readonly event: InputEvent }
  | { readonly type: 'sound'; readonly id: string; readonly durationMs: number }
  | { readonly type: 'silence' }
  | { readonly type: 'led'; readonly color: Rgba }
  | { readonly type: 'settings' };

// Short presses that close the app canvas on the bar.
const CLOSING_KEYS = new Set<Key>([
  'back',
  'busy',
  'custom',
  'off',
  'apps',
  'settings',
]);
const VOLUME_SOUND: AssetSource = {
  kind: 'stock',
  path: 'shared/volume_change.snd',
};
const KEPT_SOUNDS = 16;

export class Device {
  readonly screen: Screen;
  readonly assets: AssetLibrary;
  #brightness: 'auto' | number = 'auto';
  #volume = 50;
  #name = 'BUSY Bar Emulator';
  #timer: BusySnapshot = INITIAL_SNAPSHOT;
  #timerRunning = false;
  #timerEnd: ReturnType<typeof setTimeout> | undefined;
  readonly #now: () => number;
  readonly #listeners = new Set<(event: DeviceEvent) => void>();
  readonly #sounds = new Map<string, Sound>();
  #playing: { readonly endsAt: number } | undefined;
  #soundCount = 0;

  constructor(assets: AssetLibrary, now: () => number = Date.now) {
    this.assets = assets;
    this.#now = now;
    this.screen = new Screen({
      now,
      onChange: () => {
        this.#emit({ type: 'changed' });
      },
      animations: (element, application) => {
        const path = devicePath(element.source, application, 'animations');
        return { path, animation: assets.animation(path) };
      },
    });
  }

  get brightness(): 'auto' | number {
    return this.#brightness;
  }

  get volume(): number {
    return this.#volume;
  }

  get name(): string {
    return this.#name;
  }

  /** Whether the BUSY timer works, rests, or is paused. */
  get timerRunning(): boolean {
    return this.#timerRunning;
  }

  /** What `GET /api/busy/snapshot` answers: the timer's last change. */
  get busySnapshot(): BusySnapshot {
    return this.#timer;
  }

  /** Follow the device; returns a function that stops following. */
  on(listener: (event: DeviceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Handle `POST /api/display/draw`: 400s throw, and a 409 after the hold.
   * Animations load before the draw applies, as the bar opens the file
   * while it updates the element.
   */
  async draw(body: unknown): Promise<void> {
    const request = parseDrawRequest(body, this.assets);
    await Promise.all(
      request.elements.flatMap((element) =>
        element.type === 'animation'
          ? [this.assets.loadAnimation(element.source, request.applicationName)]
          : [],
      ),
    );
    const result = await this.screen.draw(request);
    if (result === 'low-priority') {
      throw new ApiError(409, 'Not drawn due to low priority');
    }
    if (request.ledColor !== undefined) {
      this.#emit({ type: 'led', color: request.ledColor });
    }
  }

  /**
   * Press a key as `POST /api/input` does. The status stream reports every
   * press, the release of OK, BACK and START only, the wheel keys as
   * encoder steps, and the selector keys as switch positions.
   */
  press(key: Key): void {
    if (key === 'up' || key === 'down') {
      this.#emit({
        type: 'input',
        event: { kind: 'wheel', delta: key === 'up' ? 1 : -1 },
      });
    } else if (key === 'ok' || key === 'back' || key === 'start') {
      this.#emit({
        type: 'input',
        event: { kind: 'button', button: key, action: 'press' },
      });
      this.#emit({
        type: 'input',
        event: { kind: 'button', button: key, action: 'release' },
      });
    } else {
      this.#emit({ type: 'input', event: { kind: 'selector', position: key } });
    }
    if (CLOSING_KEYS.has(key)) {
      this.screen.close();
    }
  }

  /**
   * Start or stop the BUSY timer, as the page's switch does: starting runs
   * an infinite timer, a BUSY session without an end.
   */
  setTimerRunning(running: boolean): void {
    const settings = this.#timer.snapshot.busy_bar_settings;
    this.#applyTimer(
      running
        ? startedTimer(this.#now(), settings)
        : stoppedTimer(this.#now(), settings),
    );
  }

  /**
   * Handle `PUT /api/busy/snapshot`. Like the firmware, the bar ignores a
   * snapshot no newer than the one it holds and still answers OK.
   */
  setBusySnapshot(body: unknown): void {
    const snapshot = parseBusySnapshot(body, this.#now());
    if (snapshot === undefined) {
      throw new ApiError(400, 'Failed to parse snapshot');
    }
    if (snapshot.snapshot_timestamp_ms > this.#timer.snapshot_timestamp_ms) {
      this.#applyTimer(snapshot);
    }
  }

  setBrightness(value: 'auto' | number): void {
    this.#brightness = value;
    this.#emit({ type: 'settings' });
  }

  /** Set the volume, playing the bar's volume sound unless `silent`. */
  async setVolume(value: number, silent: boolean): Promise<void> {
    this.#volume = value;
    this.#emit({ type: 'settings' });
    if (!silent) {
      await this.play('system', VOLUME_SOUND).catch(() => undefined);
    }
  }

  setName(name: string): void {
    this.#name = name;
    this.#emit({ type: 'settings' });
  }

  /** Handle `POST /api/audio/play`. */
  async play(application: string, source: AssetSource): Promise<void> {
    const sound = await this.assets.sound(source, application);
    if (sound === undefined) {
      throw new ApiError(404, 'Failed to play audio');
    }
    this.#soundCount += 1;
    const id = String(this.#soundCount);
    this.#sounds.set(id, sound);
    for (const old of this.#sounds.keys()) {
      if (this.#sounds.size <= KEPT_SOUNDS) {
        break;
      }
      this.#sounds.delete(old);
    }
    this.#playing = { endsAt: this.#now() + sound.durationMs };
    this.#emit({ type: 'sound', id, durationMs: sound.durationMs });
  }

  /** Handle `DELETE /api/audio/play`: 410 when nothing plays. */
  stopSound(): void {
    const playing = this.#playing;
    this.#playing = undefined;
    if (playing === undefined || playing.endsAt <= this.#now()) {
      throw new ApiError(410, 'No audio is playing');
    }
    this.#emit({ type: 'silence' });
  }

  /** A sound the page was told to play. */
  sound(id: string): Sound | undefined {
    return this.#sounds.get(id);
  }

  /**
   * Run the timer from `snapshot`. While it runs (or is paused) the
   * firmware's loader holds the screen above every app priority; a timer
   * that runs out frees it without recording a new snapshot.
   */
  #applyTimer(snapshot: BusySnapshot): void {
    this.#timer = snapshot;
    clearTimeout(this.#timerEnd);
    const end = stopsAt(snapshot);
    const running = end === undefined || end > this.#now();
    if (running && end !== undefined) {
      // A timer may run for a day; it must not keep the process alive.
      this.#timerEnd = setTimeout(() => {
        this.#setTimerRunning(false);
      }, end - this.#now()).unref();
    }
    this.#setTimerRunning(running);
  }

  #setTimerRunning(running: boolean): void {
    this.#timerRunning = running;
    this.screen.setLoaderPriority(running ? TIMER_PRIORITY : IDLE_PRIORITY);
    this.#emit({ type: 'settings' });
  }

  #emit(event: DeviceEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}
