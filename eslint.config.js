// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

// Apps Script injects these as ambient globals. `src/core` must stay pure —
// zero I/O, zero Apps Script — so it's the only place we block them at lint
// time; adapters/infra/triggers are exactly where these are allowed to appear.
const appsScriptGlobals = [
  'SpreadsheetApp',
  'Classroom',
  'UrlFetchApp',
  'PropertiesService',
  'LockService',
  'Logger',
  'ScriptApp',
  'Session',
  'Utilities',
  'HtmlService',
  'CacheService',
];

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '.clasp.json'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^(\\.\\.\\/)*adapters/]",
          message: 'src/core must not import from src/adapters — depend on src/ports instead.',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...appsScriptGlobals.map((name) => ({
          name,
          message: `${name} is an Apps Script global — src/core must stay pure. Use a port instead.`,
        })),
      ],
    },
  },
  prettierConfig,
];
