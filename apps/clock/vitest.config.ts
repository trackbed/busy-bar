import { createProjectVitestConfig } from '../../vitest.factory.mjs';

export default createProjectVitestConfig({
  coverageThresholds: {
    statements: 95,
    branches: 85,
    functions: 95,
    lines: 95,
  },
  // The process entry point only wires the kit together; render-clock.ts holds
  // the behavior.
  coverageExclude: ['src/main.ts'],
});
