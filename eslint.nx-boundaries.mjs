// @ts-check
import nxPlugin from '@nx/eslint-plugin';

import { depConstraints } from './project-boundaries.mjs';

const nxModuleBoundaryOptions = {
  enforceBuildableLibDependency: false,
  banTransitiveDependencies: true,
  // Root config factories that every project's tooling config imports.
  allow: ['vitest.factory.mjs'],
  depConstraints,
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nxPlugin.configs['flat/base'],
  {
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', nxModuleBoundaryOptions],
    },
  },
];
