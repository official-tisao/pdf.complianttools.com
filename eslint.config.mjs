import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import { noEngineFetch, noUntranslatedCopy, noUnsafeDom } from './scripts/eslint-rules.mjs';

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
        Blob: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        document: 'readonly',
        DragEvent: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FileList: 'readonly',
        MouseEvent: 'readonly',
        // PageGrid measures its rendered column count so the keyboard handlers
        // agree with the stylesheet's responsive breakpoints.
        HTMLDivElement: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
      // JSON-LD must be injected as raw markup: there is no Svelte element for
      // it. Every call site concatenates JSONLD_OPEN + JSON.stringify(...) +
      // JSONLD_CLOSE from $lib/seo, so the payload is serialised by us rather
      // than interpolated from page copy.
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    // Build/tooling config runs in Node, not the browser, so it gets the Node
    // globals. `svelte.config.js` reads process.env to decide whether to
    // register the service worker, which is a production-only concern.
    files: ['**/svelte.config.js', '**/vite.config.ts', '**/vite.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      'packages/**/*.test.mjs',
      'apps/relay/test/**/*.mjs',
      // Contract suites under tests/ run in Node under `node --test`, and read
      // the build output through `new URL(...)`, so they need the same globals.
      'tests/**/*.mjs',
      'playwright.config.ts',
    ],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        DOMException: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        Response: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        performance: 'readonly',
        // A measurement harness times work inside `page.evaluate`, whose
        // callback body executes in the BROWSER, not in Node. These are that
        // page context's globals, not this script's.
        document: 'readonly',
        Event: 'readonly',
        requestAnimationFrame: 'readonly',
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
          'no-untranslated-copy': noUntranslatedCopy,
        },
      },
    },
    rules: {
      'project-security/no-unsafe-dom': 'error',
      'project-security/no-engine-fetch': 'error',
      // STCC #11: `en-XA` cannot detect a literal typed straight into a template,
      // because pseudo() is applied to the fallback passed to translate(). This
      // catches that at authorship instead of after it ships.
      'project-security/no-untranslated-copy': 'error',
    },
  },
  prettier,
];
