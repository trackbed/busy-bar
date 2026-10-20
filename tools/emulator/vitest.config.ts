import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },
  // The process entry points and the browser page only wire modules
  // together (or call GitHub); the device, renderer, and server modules hold
  // the behaviour.
  coverageExclude: ['src/main.ts', 'src/pin-firmware.ts', 'src/web/**'],
});
