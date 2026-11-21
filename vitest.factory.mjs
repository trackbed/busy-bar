// @ts-check
// Shared Vitest config factory for TypeScript projects. Every project's
// vitest.config.ts calls createProjectVitestConfig(). Coverage is always
// collected and its thresholds always apply, so a local `test` run and CI agree.

import { coverageConfigDefaults, defineConfig } from 'vitest/config';

/** @import { ProjectVitestConfigOptions } from './vitest.factory.d.mts' */

/** @param {ProjectVitestConfigOptions} options */
export function createProjectVitestConfig({
  coverageThresholds,
  coverageExclude = [],
}) {
  return defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      coverage: {
        enabled: true,
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        reportOnFailure: true,
        include: ['src/**/*.ts'],
        exclude: [
          ...coverageConfigDefaults.exclude,
          'src/**/__tests__/**',
          ...coverageExclude,
        ],
        thresholds: { ...coverageThresholds },
      },
    },
  });
}
