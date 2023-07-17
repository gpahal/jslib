/** @type {import("eslint").Linter.Config} */
const config = {
  root: true,
  extends: [
    'turbo',
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vitest-globals/recommended',
    'prettier',
  ],
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
    warnOnUnsupportedTypeScriptVersion: true,
    project: './tsconfig.eslint.json',
  },
  plugins: ['@typescript-eslint', 'unicorn'],
  rules: {
    'no-unused-vars': 'off',
    'no-restricted-imports': [
      'error',
      {
        patterns: ['..*'],
      },
    ],
    'unicorn/filename-case': [
      'error',
      {
        cases: {
          kebabCase: true,
        },
      },
    ],
    'unicorn/prefer-node-protocol': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'no-type-imports' }],
    '@typescript-eslint/no-misused-promises': [2, { checksVoidReturn: { attributes: false } }],
    '@typescript-eslint/no-floating-promises': ['error'],
    '@typescript-eslint/prefer-nullish-coalescing': ['off'],
    '@typescript-eslint/unbound-method': ['off'],
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}'],
      env: {
        'vitest-globals/env': true,
      },
    },
  ],
  reportUnusedDisableDirectives: true,
}

module.exports = config
