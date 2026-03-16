import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  js.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022
      }
    },
    rules: {
      // ─── Possible errors ───────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',

      // ─── Best practices ────────────────────────────────────────────
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // ─── Style (handled by Prettier, kept minimal here) ────────────
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],

      // ─── Svelte specific ───────────────────────────────────────────
      'svelte/no-unused-svelte-ignore': 'warn',
      'svelte/valid-compile': 'error'
    }
  },
  {
    files: ['src/tests/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        // Vitest globals (we run Vitest with `globals: true`)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    }
  },
  {
    // Ignore build artifacts and dependencies
    ignores: [
      'build/**',
      '.svelte-kit/**',
      'node_modules/**',
      'dist/**'
    ]
  }
];
