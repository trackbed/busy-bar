// @ts-check
// Shared Vitest config factory for TypeScript projects. Every project's
// vitest.config.ts calls createProjectVitestConfig(). Coverage is always
// collected and its thresholds always apply, so a local `test` run and CI agree.

import { coverageConfigDefaults, defineConfig } from 'vitest/config';

/**
 * @typedef {object} CoverageThresholds
 * @property {number} statements
 * @property {number} branches
 * @property {number} functions
 * @property {number} lines
 */

/**
 * @typedef {object} ProjectVitestConfigOptions
 * @property {CoverageThresholds} coverageThresholds Ratchet these upward;
 *   never lower them to make a change pass.
 * @property {string[]} [coverageExclude] Extra source globs without behavior
 *   worth covering, such as a process entry point. Explain each in a comment.
 */

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
