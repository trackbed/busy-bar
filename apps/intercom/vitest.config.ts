import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },
  // The process entry points only connect Convex, the bar, and the modules
  // (main.ts) or print sample frames (preview.ts). The modules they connect
  // hold the behavior and are tested.
  coverageExclude: ['src/main.ts', 'src/preview.ts'],
});
