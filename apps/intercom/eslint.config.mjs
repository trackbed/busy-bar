// @ts-check
import { createProjectEslintConfig } from '../../eslint.factory.mjs';

export default [
  // `convex dev` writes this code; it carries its own lint directives.
  { ignores: ['src/convex/_generated/**'] },
  ...createProjectEslintConfig({
    kind: 'app',
    tsconfigRootDir: import.meta.dirname,
  }),
];
