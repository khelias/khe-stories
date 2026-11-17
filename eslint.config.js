import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['output', 'node_modules', 'playwright-report', 'test-results', 'eslint.config.js']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.sw.json', './tsconfig.node.json', './tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
]);
