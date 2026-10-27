import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 90,
    functions: 95,
    lines: 95,
  },
  // The process entry points only wire the kit together (main.ts) or print
  // sample frames (preview.ts); render.ts holds the behavior.
  coverageExclude: ['src/main.ts', 'src/preview.ts'],
});
