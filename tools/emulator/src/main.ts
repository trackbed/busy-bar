// Run the emulator: fetch the firmware's fonts and stock assets into the
// cache (once; later starts work offline), then serve the bar's API and the
// page on http://127.0.0.1:8080. EMULATOR_HOST and EMULATOR_PORT change
// where it listens.

import { join } from 'node:path';
import { stdout } from 'node:process';

import { FIRMWARE_COMMIT, openFirmwareAssets } from './assets/firmware.ts';
import { Device } from './device/device.ts';
import { SceneRenderer } from './render/scene.ts';
import { loadPage } from './server/page.ts';
import { Emulator } from './server/server.ts';

const host = process.env['EMULATOR_HOST']?.trim() || '127.0.0.1';
const port = Number(process.env['EMULATOR_PORT']?.trim() || '8080');

const assets = await openFirmwareAssets({
  onProgress: (done, total) => {
    if (stdout.isTTY) {
      stdout.write(`\rFirmware assets: ${done}/${total}`);
      if (done === total) {
        stdout.write('\n');
      }
    }
  },
});
const device = new Device(assets);
const emulator = new Emulator({
  device,
  renderer: new SceneRenderer(assets),
  page: await loadPage(join(import.meta.dirname, 'web')),
  firmwareCommit: FIRMWARE_COMMIT,
});
const bound = await emulator.listen(port, host);
console.log(`BUSY Bar emulator: http://${host}:${bound}`);
console.log(`Point apps at it with BUSYBAR_ADDR=${host}:${bound}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void emulator.close().then(() => process.exit(0));
  });
}
