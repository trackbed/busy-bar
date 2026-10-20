// The emulator's page: draws the frames the server renders, presses keys
// through the bar's own /api/input, and plays the sounds apps start.

const FRONT = { width: 72, height: 16 };
const BACK = { width: 160, height: 80 };
// The SSD1320 drive levels the firmware programs for the back panel's 16
// grey levels, out of 63.
const BACK_LEVELS = [
  0, 2, 4, 7, 10, 14, 18, 22, 27, 31, 36, 41, 47, 52, 58, 63,
];
// Below this channel sum an LED counts as off, as busy-lib's LED view does.
const DARK_THRESHOLD = 0.04 * 3 * 255;

interface State {
  readonly application?: string;
  readonly priority?: number;
  readonly loaderPriority: number;
  readonly elements: number;
  readonly timerRunning: boolean;
  readonly brightness: 'auto' | number;
  readonly volume: number;
}

function find<T extends Element>(
  selector: string,
  type: { new (): T; prototype: T },
): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) {
    throw new Error(`The page has no ${selector}.`);
  }
  return element;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = canvas.getContext('2d');
  if (result === null) {
    throw new Error('Canvas 2D is not available.');
  }
  return result;
}

const front = context(find('#front', HTMLCanvasElement));
const back = context(find('#back', HTMLCanvasElement));
const led = find('#led', HTMLSpanElement);
const timer = find('#timer', HTMLInputElement);
const soundToggle = find('#sound', HTMLInputElement);
const stateList = find('#state', HTMLDListElement);
const connection = find('#connection', HTMLSpanElement);
find('#address', HTMLElement).textContent = `BUSYBAR_ADDR=${location.host}`;

let volume = 50;
let playing: HTMLAudioElement | undefined;

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** The front display as LEDs: one rounded square per pixel. */
function drawFront(rgb: Uint8Array): void {
  const cell = front.canvas.width / FRONT.width;
  const size = cell * 0.85;
  const inset = (cell - size) / 2;
  front.fillStyle = '#000';
  front.fillRect(0, 0, front.canvas.width, front.canvas.height);
  for (let y = 0; y < FRONT.height; y += 1) {
    for (let x = 0; x < FRONT.width; x += 1) {
      const at = (y * FRONT.width + x) * 3;
      const [r = 0, g = 0, b = 0] = rgb.subarray(at, at + 3);
      front.fillStyle =
        r + g + b < DARK_THRESHOLD ? '#111' : `rgb(${r} ${g} ${b})`;
      front.beginPath();
      front.roundRect(x * cell + inset, y * cell + inset, size, size, size / 4);
      front.fill();
    }
  }
}

/** The back display at its 16 grey levels, as the panel lights them. */
function drawBack(packed: Uint8Array): void {
  const image = new ImageData(BACK.width, BACK.height);
  for (let pixel = 0; pixel < BACK.width * BACK.height; pixel += 1) {
    const byte = packed[pixel >> 1] ?? 0;
    const level = pixel % 2 === 0 ? byte & 0x0f : byte >> 4;
    const light = (BACK_LEVELS[level] ?? 0) / 63;
    const value = Math.round(
      255 *
        (light <= 0.0031308
          ? 12.92 * light
          : 1.055 * light ** (1 / 2.4) - 0.055),
    );
    image.data.set([value, value, value, 255], pixel * 4);
  }
  const bitmap = new OffscreenCanvas(BACK.width, BACK.height);
  context2d(bitmap).putImageData(image, 0, 0);
  back.imageSmoothingEnabled = false;
  back.drawImage(bitmap, 0, 0, back.canvas.width, back.canvas.height);
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const result = canvas.getContext('2d');
  if (result === null) {
    throw new Error('Canvas 2D is not available.');
  }
  return result;
}

function showState(state: State): void {
  volume = state.volume;
  timer.checked = state.timerRunning;
  const rows: [string, string][] = [
    ['App drawing', state.application ?? 'none (canvas closed)'],
    ['Priority', state.priority === undefined ? '-' : String(state.priority)],
    [
      'Loader priority',
      `${state.loaderPriority}${state.timerRunning ? ' (BUSY timer)' : ''}`,
    ],
    ['Elements', String(state.elements)],
    ['Brightness', String(state.brightness)],
    ['Volume', String(state.volume)],
  ];
  stateList.replaceChildren(
    ...rows.flatMap(([term, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

/** The bar blinks its LED three times for `led_notification_color`. */
function blink(color: { r: number; g: number; b: number }): void {
  const on = `rgb(${color.r} ${color.g} ${color.b})`;
  led.animate(
    [
      { background: on, boxShadow: `0 0 8px ${on}` },
      { background: '#333', boxShadow: 'none' },
    ],
    { duration: 400, iterations: 3 },
  );
}

async function press(key: string): Promise<void> {
  await fetch(`/api/input?key=${encodeURIComponent(key)}`, { method: 'POST' });
}

function parse(event: Event): unknown {
  return event instanceof MessageEvent && typeof event.data === 'string'
    ? JSON.parse(event.data)
    : undefined;
}

function isState(value: unknown): value is State {
  return (
    typeof value === 'object' &&
    value !== null &&
    (!('application' in value) || typeof value.application === 'string') &&
    (!('priority' in value) || isNumber(value.priority)) &&
    'loaderPriority' in value &&
    isNumber(value.loaderPriority) &&
    'elements' in value &&
    isNumber(value.elements) &&
    'timerRunning' in value &&
    typeof value.timerRunning === 'boolean' &&
    'brightness' in value &&
    (value.brightness === 'auto' || isNumber(value.brightness)) &&
    'volume' in value &&
    isNumber(value.volume)
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const events = new EventSource('/emulator/events');
events.addEventListener('open', () => {
  connection.textContent = 'live';
  connection.classList.add('live');
});
events.addEventListener('error', () => {
  connection.textContent = 'reconnecting…';
  connection.classList.remove('live');
});
events.addEventListener('frame', (event) => {
  const data = parse(event);
  if (
    typeof data === 'object' &&
    data !== null &&
    'front' in data &&
    'back' in data
  ) {
    if (typeof data.front === 'string') {
      drawFront(decode(data.front));
    }
    if (typeof data.back === 'string') {
      drawBack(decode(data.back));
    }
  }
});
events.addEventListener('state', (event) => {
  const data = parse(event);
  if (isState(data)) {
    showState(data);
  }
});
events.addEventListener('sound', (event) => {
  const data = parse(event);
  if (
    !soundToggle.checked ||
    typeof data !== 'object' ||
    data === null ||
    !('url' in data)
  ) {
    return;
  }
  if (typeof data.url === 'string') {
    playing?.pause();
    playing = new Audio(data.url);
    playing.volume = volume / 100;
    void playing.play().catch(() => undefined);
  }
});
events.addEventListener('silence', () => {
  playing?.pause();
});
events.addEventListener('led', (event) => {
  const data = parse(event);
  if (
    typeof data === 'object' &&
    data !== null &&
    'r' in data &&
    'g' in data &&
    'b' in data
  ) {
    const { r, g, b } = data;
    if (
      typeof r === 'number' &&
      typeof g === 'number' &&
      typeof b === 'number'
    ) {
      blink({ r, g, b });
    }
  }
});

for (const button of document.querySelectorAll('button[data-key]')) {
  if (button instanceof HTMLButtonElement) {
    button.addEventListener('click', () => {
      void press(button.dataset['key'] ?? '');
    });
  }
}

find('#wheel', HTMLDivElement).addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    void press(event.deltaY < 0 ? 'up' : 'down');
  },
  { passive: false },
);

const SHORTCUTS: Readonly<Record<string, string>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Enter: 'ok',
  Escape: 'back',
  ' ': 'start',
};

document.addEventListener('keydown', (event) => {
  const key = SHORTCUTS[event.key];
  if (key !== undefined && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    void press(key);
  }
});

timer.addEventListener('change', () => {
  void fetch(`/emulator/timer?running=${timer.checked ? '1' : '0'}`, {
    method: 'POST',
  });
});
