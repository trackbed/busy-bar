import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

// Nx runs emulator tests from the project root. DOM-mode import.meta.url is HTTP.
const HTML = readFileSync(resolve('src/web/index.html'), 'utf8');

interface Sound {
  readonly url: string;
  volume: number;
  readonly play: Mock<() => Promise<void>>;
  readonly pause: Mock<() => void>;
}

function find<T extends Element>(
  selector: string,
  type: { new (): T; prototype: T },
): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) {
    throw new Error(`The page fixture has no ${selector}.`);
  }
  return element;
}

function canvasContext(canvas: { width: number; height: number }) {
  const fills: string[] = [];
  const context = {
    canvas,
    fills,
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect:
      vi.fn<(x: number, y: number, width: number, height: number) => void>(),
    beginPath: vi.fn<() => void>(),
    roundRect: vi.fn<(...coordinates: number[]) => void>(),
    fill: vi.fn<() => void>(() => {
      fills.push(context.fillStyle);
    }),
    putImageData: vi.fn<(image: ImageData, x: number, y: number) => void>(),
    drawImage: vi.fn<(image: unknown, ...coordinates: number[]) => void>(),
  };
  return context;
}

/** Real page markup and event dispatch, with browser I/O recorded at its boundary. */
export function webPage() {
  document.documentElement.innerHTML = HTML;
  const listeners = vi.spyOn(document, 'addEventListener');
  const frontCanvas = find('#front', HTMLCanvasElement);
  const backCanvas = find('#back', HTMLCanvasElement);
  const front = canvasContext(frontCanvas);
  const back = canvasContext(backCanvas);
  Object.defineProperty(frontCanvas, 'getContext', { value: () => front });
  Object.defineProperty(backCanvas, 'getContext', { value: () => back });

  const bitmaps: Offscreen[] = [];
  class Offscreen {
    readonly width: number;
    readonly height: number;
    readonly context: ReturnType<typeof canvasContext>;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.context = canvasContext(this);
      bitmaps.push(this);
    }

    getContext() {
      return this.context;
    }
  }
  vi.stubGlobal('OffscreenCanvas', Offscreen);
  vi.stubGlobal(
    'ImageData',
    class {
      readonly data: Uint8ClampedArray;

      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );

  const events = new EventTarget();
  const connect = vi.fn<() => EventTarget>(function () {
    return events;
  });
  vi.stubGlobal('EventSource', connect);
  vi.stubGlobal('location', new URL('http://127.0.0.1:8080'));
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  vi.stubGlobal('fetch', request);

  const play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const sounds: Sound[] = [];
  const audio = vi.fn<(url: string) => Sound>(function (url) {
    const sound = { url, volume: 1, play, pause: vi.fn<() => void>() };
    sounds.push(sound);
    return sound;
  });
  vi.stubGlobal('Audio', audio);
  const animate =
    vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => void>();
  Object.defineProperty(find('#led', HTMLSpanElement), 'animate', {
    value: animate,
  });

  return {
    front,
    back,
    bitmaps,
    events,
    connect,
    request,
    audio,
    play,
    sounds,
    animate,
    timer: find('#timer', HTMLInputElement),
    sound: find('#sound', HTMLInputElement),
    connection: find('#connection', HTMLSpanElement),
    state: find('#state', HTMLDListElement),
    wheel: find('#wheel', HTMLDivElement),
    send(type: string, data: unknown): void {
      events.dispatchEvent(
        new MessageEvent(type, { data: JSON.stringify(data) }),
      );
    },
    cleanup(): void {
      for (const [type, listener, options] of listeners.mock.calls) {
        document.removeEventListener(type, listener, options);
      }
      document.documentElement.replaceChildren();
    },
  };
}
