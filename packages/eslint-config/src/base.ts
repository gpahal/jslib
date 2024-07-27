import eslint from '@eslint/js'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintConfigPrettier from 'eslint-config-prettier'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginImportX from 'eslint-plugin-import-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import { config, configs as tsEslintConfigs, type ConfigWithExtends } from 'typescript-eslint'

import { isFunction } from '@gpahal/std/functions'

export { config as createConfig } from 'typescript-eslint'

export type Config = typeof tsEslintConfigs.all

export default function defineConfig(
  project: string | Array<string>,
  tsconfigRootDir: string,
  ...configs: Array<Config | ((project: string, tsconfigRootDir: string) => Config)>
): Config {
  return config(
    {
      files: ['**/*.{js,mjs,cjs,ts,jsx,tsx,astro}'],
    },
    {
      languageOptions: {
        globals: { ...globals.builtin, ...globals.es2022, ...globals.node, ...globals.worker },
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          project,
          tsconfigRootDir,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: true,
      },
    },
    eslint.configs.recommended,
    ...tsEslintConfigs.recommendedTypeChecked,
    ...tsEslintConfigs.stylisticTypeChecked,
    eslintConfigPrettier as ConfigWithExtends,
    {
      plugins: {
        'import-x': eslintPluginImportX,
      },
      settings: {
        'import-x/extensions': ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'],
        'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
        'import-x/parsers': {
          '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        'import-x/resolver': {
          typescript: {
            alwaysTryTypes: true,
            project,
          },
          node: {
            extensions: ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'],
          },
        },
      },
      rules: eslintPluginImportX.configs.recommended.rules,
    },
    eslintPluginUnicorn.configs['flat/recommended'] as ConfigWithExtends,
    {
      files: ['**/*.{js,mjs,cjs,jsx}'],
      ...tsEslintConfigs.disableTypeChecked,
    },
    {
      rules: {
        'no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
          },
        ],
        'import-x/first': 'error',
        'import-x/newline-after-import': 'error',
        'import-x/no-absolute-path': 'error',
        'import-x/no-mutable-exports': 'error',
        'import-x/no-named-default': 'error',
        'import-x/no-self-import': 'error',
        'import-x/no-duplicates': 'error',
        'import-x/no-amd': 'error',
        'import-x/no-webpack-loader-syntax': 'error',
        'import-x/no-anonymous-default-export': 'error',
        'unicorn/filename-case': [
          'error',
          {
            cases: {
              kebabCase: true,
            },
          },
        ],
        'unicorn/no-null': 'off',
        'unicorn/no-array-callback-reference': 'off',
        'unicorn/no-negated-condition': 'off',
        'unicorn/no-nested-ternary': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/number-literal-case': 'off',
        'unicorn/prefer-module': 'off',
        'unicorn/prefer-node-protocol': 'error',
        'unicorn/prevent-abbreviations': 'off',
      },
    },
    {
      files: ['**/*.{ts,tsx,astro}'],
      rules: {
        'no-unused-vars': 'off',
        'import-x/default': 'off',
        'import-x/named': 'off',
        'import-x/namespace': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/no-unresolved': 'off',
        'unicorn/prefer-module': 'error',
        '@typescript-eslint/array-type': ['error', { default: 'generic' }],
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
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
        '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
        '@typescript-eslint/no-floating-promises': ['error'],
        '@typescript-eslint/prefer-nullish-coalescing': ['off'],
        '@typescript-eslint/unbound-method': ['off'],
      },
    },
    ...configs.flatMap((subConfig) =>
      isFunction(subConfig) ? (subConfig(project, tsconfigRootDir) as Config) : (subConfig as Config),
    ),
    {
      ignores: [
        '**/build',
        '**/dist',
        '**/target',
        '**/out',
        '**/out-tsc',
        '**/.output',
        '**/coverage',
        '**/.turbo',
        '**/.next',
        '**/.vercel',
        '**/.astro',
        '**/tmp',
        '**/.tmp',
        '**/.cache',
        '**/tsconfig.tsbuildinfo',
        '**/tsconfig.*.tsbuildinfo',
        '**/node_modules',
        '**/pnpm-debug.log*',
        '**/yarn-debug.log*',
        '**/yarn-error.log*',
        '**/pnpm-debug.log*',
        '**/.env',
        '**/.env.*',
        '**/.vscode',
        '**/.history',
        '**/*.code-workspace',
        '**/.idea',
        '**/.idea_modules',
        '**/*.iml',
        '**/*.ipr',
        '**/*.iws',
        '**/*~',
        '**/.DS_Store',
        '**/_*',
      ],
    },
  )
}
