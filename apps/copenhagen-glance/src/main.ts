import {
  createBusyBar,
  createPoller,
  loadBarConfig,
  runBarApp,
  shutdownSignal,
} from '@busy-bar-apps/bar-kit';

import { fetchRain } from './dmi.ts';
import { fetchCo2, fetchPrices } from './energi.ts';
import { render } from './render.ts';
import { loadSettings } from './settings.ts';

const NAME = 'copenhagen-glance';
const MINUTE_MS = 60_000;

const settings = loadSettings(process.env);
const signal = shutdownSignal();

const prices = createPoller({
  name: `${NAME} prices`,
  intervalMs: 15 * MINUTE_MS,
  retryMs: MINUTE_MS,
  fetch: (fetchSignal) => fetchPrices(settings.area, fetchSignal),
});
const co2 = createPoller({
  name: `${NAME} CO2`,
  intervalMs: 5 * MINUTE_MS,
  retryMs: MINUTE_MS,
  fetch: (fetchSignal) => fetchCo2(settings.area, fetchSignal),
});
const rain = createPoller({
  name: `${NAME} rain`,
  intervalMs: 15 * MINUTE_MS,
  // DMI often answers 429 when busy; it usually recovers within a minute.
  retryMs: MINUTE_MS,
  fetch: (fetchSignal) =>
    fetchRain(settings.latitude, settings.longitude, fetchSignal),
});

await Promise.all([
  prices.run(signal),
  co2.run(signal),
  ...(settings.rain ? [rain.run(signal)] : []),
  runBarApp({
    name: NAME,
    client: createBusyBar(loadBarConfig()),
    render: (now) =>
      render(now, {
        area: settings.area,
        prices: prices.latest(),
        co2: co2.latest(),
        rain: rain.latest(),
        rainEnabled: settings.rain,
      }),
    intervalMs: 5000,
    signal,
  }),
]);
