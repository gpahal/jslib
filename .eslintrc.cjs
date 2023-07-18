/** @type {import("eslint").Linter.Config} */
const config = {
  root: true,
  reportUnusedDisableDirectives: true,
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
  plugins: ['@typescript-eslint', 'import', 'unicorn'],
  rules: {
    'no-unused-vars': 'off',
    'no-restricted-imports': [
      'error',
      {
        patterns: ['..*'],
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
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
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    '@typescript-eslint/no-floating-promises': ['error'],
    '@typescript-eslint/prefer-nullish-coalescing': ['off'],
    '@typescript-eslint/unbound-method': ['off'],
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-absolute-path': 'error',
    'import/no-mutable-exports': 'error',
    'import/no-named-default': 'error',
    'import/no-self-import': 'error',
    'import/no-duplicates': 'error',
    'import/no-amd': 'error',
    'import/no-webpack-loader-syntax': 'error',
    'import/no-anonymous-default-export': 'error',
    'unicorn/filename-case': [
      'error',
      {
        cases: {
          kebabCase: true,
        },
      },
    ],
    'unicorn/prefer-node-protocol': 'error',
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}'],
      env: {
        'vitest-globals/env': true,
      },
    },
  ],
}

module.exports = config
