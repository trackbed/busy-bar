# copenhagen-glance

A BUSY Bar app in TypeScript for the Danish power price and the weather. The
front display shows the spot price now, in kroner per kWh, coloured by where
it sits in the next 24 hours' range, beside the grid's CO2 per kWh, or `RAIN`
when rain is due this hour. Below them, 18 bars show the price for each hour
ahead. The back display lists the price, the cheapest and dearest hour of the
next 24, the CO2, and the rain for the next three hours.

## Owns

- Reading [Energi Data Service](https://www.energidataservice.dk/)
  ([src/energi.ts](src/energi.ts)): `DayAheadPrices` in 15-minute slots and
  the latest `CO2Emis` reading. No key needed.
- Reading DMI's HARMONIE forecast ([src/dmi.ts](src/dmi.ts)) from the
  [open data API](https://opendatadocs.dmi.govcloud.dk/), and turning its
  running precipitation total into rain per hour. No key needed.
- Judging the hours ahead ([src/outlook.ts](src/outlook.ts)) and the layout
  ([src/render.ts](src/render.ts)).

## Does Not Own

- Primitive JSON validation: [`json-values`](../../libs/json-values/README.md).
- What you actually pay. The spot price excludes grid tariffs, elafgift, and
  VAT.
- Connection settings, the frame loop, polling, and shutdown handling. Those
  live in [`bar-kit`](../../libs/bar-kit/README.md).

## Start Here

- `priceOutlook(slots, now, hours)` splits the next 24 hours' price range into
  thirds (green, amber, red) and finds the cheapest and dearest hour-long
  windows.
- Prices refresh every 15 minutes, CO2 every 5, and rain every 15; each tries
  again after a minute when the source refuses. DMI often answers 429 when
  busy.

## Run

```sh
NX_DAEMON=false yarn nx run copenhagen-glance:start
```

| Variable            | Default   | What it does                                         |
| ------------------- | --------- | ---------------------------------------------------- |
| `GLANCE_PRICE_AREA` | `DK2`     | `DK2` east of the Great Belt, `DK1` west of it       |
| `GLANCE_LATITUDE`   | `55.6761` | Where to forecast rain (Copenhagen City Hall Square) |
| `GLANCE_LONGITUDE`  | `12.5683` |                                                      |
| `GLANCE_RAIN`       | `on`      | `off` skips DMI                                      |

## Verify

```sh
NX_DAEMON=false yarn nx run-many -t lint typecheck test -p copenhagen-glance
```
