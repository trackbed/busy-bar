// @ts-check
// ESLint config for workspace-root tooling: the root *.mjs modules and
// scripts/. Projects under apps/, libs/, and tools/ use their own
// eslint.config.mjs, built by eslint.factory.mjs.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { oxlintCompatConfig } from './eslint.factory.mjs';

export default defineConfig(
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.scripts.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  ...oxlintCompatConfig,
);
