// @ts-check
import { createProjectEslintConfig } from '../../eslint.factory.mjs';

export default createProjectEslintConfig({
  kind: 'tooling',
  tsconfigRootDir: import.meta.dirname,
});
