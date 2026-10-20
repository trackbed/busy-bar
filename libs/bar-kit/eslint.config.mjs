// @ts-check
import { createProjectEslintConfig } from '../../eslint.factory.mjs';

export default createProjectEslintConfig({
  kind: 'lib',
  tsconfigRootDir: import.meta.dirname,
});
