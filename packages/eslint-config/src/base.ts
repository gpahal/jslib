import path from 'node:path'
import url from 'node:url'

import { fixupPluginRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { configs as eslintPluginImportConfigs } from 'eslint-plugin-import'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tsEslint, { type ConfigWithExtends } from 'typescript-eslint'

import { isFunction } from '@gpahal/std/functions'

export type Config = typeof tsEslint.configs.all
export const createConfig = tsEslint.config

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: eslint.configs.recommended,
  allConfig: eslint.configs.all,
})

function legacyPlugin(name: string, alias: string = name) {
  const plugin = compat.plugins(name)[0]?.plugins?.[alias]
  if (!plugin) {
    throw new Error(`Unable to resolve plugin ${name} and/or alias ${alias}`)
  }

  return fixupPluginRules(plugin)
}

export default function defineConfig(
  project: string | Array<string>,
  tsconfigRootDir: string,
  ...configs: Array<Config | ((project: string, tsconfigRootDir: string) => Config)>
): Config {
  return tsEslint.config(
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
    ...tsEslint.configs.recommendedTypeChecked,
    ...tsEslint.configs.stylisticTypeChecked,
    eslintConfigPrettier as ConfigWithExtends,
    {
      plugins: {
        import: legacyPlugin('eslint-plugin-import', 'import'),
      },
      settings: {
        'import/resolver': {
          typescript: {
            alwaysTryTypes: true,
            project,
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      rules: eslintPluginImportConfigs.recommended.rules,
    },
    eslintPluginUnicorn.configs['flat/recommended'] as ConfigWithExtends,
    {
      files: ['**/*.{js,mjs,cjs,jsx}'],
      ...tsEslint.configs.disableTypeChecked,
    },
    {
      files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],
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
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-unused-vars': 'off',
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
