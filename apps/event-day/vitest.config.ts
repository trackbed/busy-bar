import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },
  // The process entry points only read settings and connect the modules
  // (main.ts) or print sample frames (preview.ts). What a poll does lives in
  // event.ts and the layout in render.ts, both tested.
  coverageExclude: ['src/main.ts', 'src/preview.ts'],
});
