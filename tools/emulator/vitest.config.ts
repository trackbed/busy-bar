import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },
  // Process entry points only wire modules together (or call GitHub).
  coverageExclude: ['src/main.ts', 'src/pin-firmware.ts'],
});
