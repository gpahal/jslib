import eslint from '@eslint/js'
import eslintPluginJson from '@eslint/json'
import gitignore from 'eslint-config-flat-gitignore'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintConfigPrettier from 'eslint-config-prettier'
import { configs as eslintDependConfigs } from 'eslint-plugin-depend'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import eslintPluginImportX from 'eslint-plugin-import-x'
import * as eslintPluginMdx from 'eslint-plugin-mdx'
import { configs as eslintPluginRegexpConfigs } from 'eslint-plugin-regexp'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import globals from 'globals'

import { isFunction } from '@gpahal/std/functions'

import { config, tsEslintConfigs, tsEslintParser, type ConfigArray, type ConfigFn } from './common'

export { config as createConfig } from './common'

const FILES_WITHOUT_TYPES_EXTNS = ['js', 'mjs', 'cjs', 'jsx']
const FILES_WITH_TYPES_EXTNS = ['ts', 'tsx', 'astro']
const FILES_EXTNS = [...FILES_WITHOUT_TYPES_EXTNS, ...FILES_WITH_TYPES_EXTNS]

const FILES_WITHOUT_TYPES = ['**/*.{' + FILES_WITHOUT_TYPES_EXTNS.join(',') + '}']
const FILES_WITH_TYPES = ['**/*.{' + FILES_WITH_TYPES_EXTNS.join(',') + '}']
const FILES = ['**/*.{' + FILES_EXTNS.join(',') + '}']

export type BaseConfigOptions = {
  tsconfigRootDir: string
  tsconfigPaths: string | Array<string>
  configs: Array<ConfigArray | ConfigFn>
}

export default function defineConfig({
  tsconfigRootDir,
  tsconfigPaths,
  configs,
}: BaseConfigOptions): ConfigArray {
  return config(
    gitignore({
      strict: false,
    }),
    {
      ignores: [
        '**/_gen',
        '**/_generated',
        '**/*.gen',
        '**/*.generated',
        '**/*.gen.*',
        '**/*.generated.*',
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
    {
      files: FILES,
      languageOptions: {
        globals: { ...globals.builtin, ...globals.es2022, ...globals.node, ...globals.worker },
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          tsconfigRootDir,
          project: tsconfigPaths,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: true,
      },
    },
    {
      files: FILES,
      extends: [
        eslint.configs.recommended,
        ...tsEslintConfigs.recommendedTypeChecked,
        ...tsEslintConfigs.stylisticTypeChecked,
        eslintPluginRegexpConfigs['flat/recommended'],
        eslintPluginUnicorn.configs.recommended,
        eslintConfigPrettier,
        eslintDependConfigs['flat/recommended'],
      ],
    },
    {
      files: FILES,
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
            tsconfigRootDir,
            project: tsconfigPaths,
          },
          node: {
            extensions: ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'],
          },
        },
      },
      rules: {
        ...eslintPluginImportX.configs.recommended.rules,
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
      files: FILES_WITH_TYPES,
      languageOptions: {
        parserOptions: {
          sourceType: 'module',
          ecmaVersion: 'latest',
          parser: tsEslintParser,
          extraFileExtensions: ['.astro'],
          tsconfigRootDir,
          project: tsconfigPaths,
        },
      },
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
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
        '@typescript-eslint/no-floating-promises': ['error'],
        '@typescript-eslint/prefer-nullish-coalescing': ['off'],
        '@typescript-eslint/unbound-method': ['off'],
      },
    },
    {
      files: ['**/*.json'],
      ignores: ['package-lock.json'],
      plugins: {
        json: eslintPluginJson,
      },
      language: 'json/json',
      rules: eslintPluginJson.configs.recommended.rules,
    },
    {
      files: ['**/*.jsonc', '.vscode/*.json'],
      plugins: {
        json: eslintPluginJson,
      },
      language: 'json/jsonc',
      rules: eslintPluginJson.configs.recommended.rules,
    },
    {
      files: ['**/*.json5'],
      plugins: {
        json: eslintPluginJson,
      },
      language: 'json/json5',
      rules: eslintPluginJson.configs.recommended.rules,
    },
    {
      ...eslintPluginMdx.flat,
      processor: eslintPluginMdx.createRemarkProcessor({
        lintCodeBlocks: true,
        languageMapper: {},
      }),
    },
    {
      ...eslintPluginMdx.flatCodeBlocks,
      rules: {
        ...eslintPluginMdx.flatCodeBlocks.rules,
        'no-var': 'error',
        'prefer-const': 'error',
        'import-x/no-anonymous-default-export': 'off',
        'unicorn/filename-case': 'off',
        'react-hooks/rules-of-hooks': 'off',
      },
    },
    ...configs.flatMap((subConfig) =>
      isFunction(subConfig)
        ? (subConfig(tsconfigRootDir, tsconfigPaths) as ConfigArray)
        : (subConfig as ConfigArray),
    ),
    {
      files: [...FILES_WITHOUT_TYPES, '**/*.{md,mdx}/**', '**/*.astro/*.ts'],
      extends: [tsEslintConfigs.disableTypeChecked],
    },
    {
      files: ['**/*.md/**'],
      rules: {
        'import-x/no-anonymous-default-export': 'off',
        'unicorn/filename-case': 'off',
      },
    },
    {
      files: ['**/*.config.{' + FILES_EXTNS.join(',') + '}'],
      rules: {
        'import-x/no-anonymous-default-export': 'off',
        'unicorn/filename-case': 'off',
        'unicorn/no-abusive-eslint-disable': 'off',
      },
    },
  )
}
