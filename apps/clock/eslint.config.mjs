// @ts-check
import { createProjectEslintConfig } from '../../eslint.factory.mjs';

export default createProjectEslintConfig({
  kind: 'app',
  tsconfigRootDir: import.meta.dirname,
});
