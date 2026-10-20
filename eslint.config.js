import js from '@eslint/js';
import query from '@tanstack/eslint-plugin-query';
import router from '@tanstack/eslint-plugin-router';
import prettier from 'eslint-config-prettier';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.tanstack/**',
      'src/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': hooks,
      'react-refresh': refresh,
      '@tanstack/query': query,
      '@tanstack/router': router,
    },
    rules: {
      ...hooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/stable-query-client': 'error',
      '@tanstack/router/create-route-property-order': 'error',
    },
  },
  {
    files: ['*.{js,ts}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': ['error', { allowExportNames: ['Route'] }] },
  },
  prettier,
];
