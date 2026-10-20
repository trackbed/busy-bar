// @ts-check
// Shared ESLint flat-config factory for TypeScript projects. Every project's
// eslint.config.mjs calls createProjectEslintConfig().
//
// Oxlint runs its correctness rules first (the `oxlint` target, which `lint`
// depends on), and eslint-plugin-oxlint turns the overlapping ESLint rules off.
// ESLint owns type-aware rules, Nx module boundaries, import cycles, comment
// hygiene, and Vitest rules.

import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import vitest from '@vitest/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import oxlint from 'eslint-plugin-oxlint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import nxBoundaries from './eslint.nx-boundaries.mjs';

/**
 * - `app`: a runnable BUSY Bar app. May log to the console.
 * - `lib`: a shared library. No console output and no default exports.
 * - `tooling`: workspace tooling such as Nx plugins and generators.
 *
 * @typedef {'app' | 'lib' | 'tooling'} ProjectKind
 */

/** @type {ReadonlySet<string>} */
const PROJECT_KINDS = new Set(['app', 'lib', 'tooling']);

const TS_FILES = ['**/*.ts'];
const TEST_FILES = ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'];

export const oxlintCompatConfig = oxlint.buildFromOxlintConfigFile(
  `${import.meta.dirname}/.oxlintrc.json`,
);

/** @type {import('eslint').Linter.RulesRecord} */
const typeScriptRules = {
  '@typescript-eslint/consistent-type-exports': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/no-import-type-side-effects': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/prefer-nullish-coalescing': [
    'error',
    { ignoreConditionalTests: true, ignorePrimitives: { string: true } },
  ],
  '@typescript-eslint/restrict-template-expressions': [
    'error',
    { allowNumber: true },
  ],
  '@typescript-eslint/return-await': [
    'error',
    'error-handling-correctness-only',
  ],
  '@typescript-eslint/switch-exhaustiveness-check': [
    'error',
    {
      allowDefaultCaseForExhaustiveSwitch: true,
      requireDefaultForNonUnion: false,
    },
  ],
  // Object-literal assertions (`{ ... } as Foo`) skip excess-property checks.
  // Annotate the variable or use `satisfies` instead.
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
  ],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
};

/**
 * Build the ESLint flat config for one TypeScript project.
 *
 * @param {{ kind: ProjectKind, tsconfigRootDir: string }} options
 *   `tsconfigRootDir` is the project directory; pass `import.meta.dirname`.
 */
export function createProjectEslintConfig({ kind, tsconfigRootDir }) {
  if (!PROJECT_KINDS.has(kind)) {
    throw new Error(
      `createProjectEslintConfig: unknown kind ${JSON.stringify(kind)}. ` +
        `Expected one of ${[...PROJECT_KINDS].join(', ')}.`,
    );
  }

  return defineConfig(
    { ignores: ['coverage/**', 'dist/**'] },
    {
      files: TS_FILES,
      extends: [
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: typeScriptRules,
    },
    {
      files: TS_FILES,
      plugins: { 'import-x': importX },
      settings: {
        'import-x/resolver-next': [
          createTypeScriptImportResolver({
            project: `${tsconfigRootDir}/tsconfig.json`,
          }),
        ],
      },
      rules: {
        'import-x/no-cycle': ['error', { ignoreExternal: true, maxDepth: 3 }],
      },
    },
    ...nxBoundaries,
    {
      files: TEST_FILES,
      extends: [vitest.configs.recommended],
      rules: {
        'vitest/no-commented-out-tests': 'error',
        'vitest/no-disabled-tests': 'error',
        'vitest/no-focused-tests': 'error',
        'vitest/no-standalone-expect': 'error',
        'vitest/valid-title': 'error',
      },
    },
    {
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      plugins: { '@eslint-community/eslint-comments': eslintComments },
      rules: {
        '@eslint-community/eslint-comments/require-description': 'error',
      },
    },
    kind === 'lib'
      ? {
          // Tool configs such as vitest.config.ts must default-export.
          files: ['src/**/*.ts'],
          ignores: TEST_FILES,
          rules: {
            'import-x/no-default-export': 'error',
            'no-console': 'error',
          },
        }
      : {},
    ...oxlintCompatConfig,
  );
}
