import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import { noEngineFetch, noUnsafeDom } from './scripts/eslint-rules.mjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/dist/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
      'saas-template/**',
      'fixtures/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        DragEvent: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FileList: 'readonly',
        MouseEvent: 'readonly',
      },
    },
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'packages/**/*.test.mjs', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        DOMException: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{js,mjs,ts,svelte}'],
    plugins: {
      'project-security': {
        rules: {
          'no-unsafe-dom': noUnsafeDom,
          'no-engine-fetch': noEngineFetch,
        },
      },
    },
    rules: {
      'project-security/no-unsafe-dom': 'error',
      'project-security/no-engine-fetch': 'error',
    },
  },
  prettier,
];
